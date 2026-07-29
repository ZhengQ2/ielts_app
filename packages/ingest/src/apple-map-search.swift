import Foundation
import MapKit

struct PilotInput: Decodable {
    let records: [PilotRecord]
}

struct PilotRecord: Decodable {
    let id: String
    let queries: [PilotQuery]
    let searchRegion: SearchRegion?
}

struct SearchRegion: Decodable {
    let centerLatitude: Double
    let centerLongitude: Double
    let latitudeDelta: Double
    let longitudeDelta: Double
}

struct PilotQuery: Codable {
    let kind: String
    let text: String
}

struct SearchCandidate: Codable {
    let rank: Int
    let name: String
    let address: String
    let latitude: Double
    let longitude: Double
    let phone: String?
    let url: String?
}

struct SearchAttempt: Codable {
    let kind: String
    let query: String
    let candidates: [SearchCandidate]
    let error: String?
}

struct CentreResult: Codable {
    let centreId: String
    let searches: [SearchAttempt]
}

struct PilotOutput: Codable {
    let version: Int
    let generatedAt: String
    var records: [CentreResult]
}

struct Arguments {
    let input: URL
    let output: URL
    let delayMilliseconds: UInt64
    let maximumCandidates: Int
}

@main
struct AppleMapSearch {
    static func main() async throws {
        let arguments = try parseArguments()
        let input = try JSONDecoder().decode(
            PilotInput.self,
            from: Data(contentsOf: arguments.input)
        )
        var completed = try existingResults(at: arguments.output)
        let completedIds = Set(completed.map(\.centreId))

        for (index, record) in input.records.enumerated() {
            if completedIds.contains(record.id) {
                fputs("[\(index + 1)/\(input.records.count)] cached \(record.id)\n", stderr)
                continue
            }

            var searches: [SearchAttempt] = []
            for query in record.queries {
                searches.append(
                    await search(
                        query,
                        region: record.searchRegion,
                        maximumCandidates: arguments.maximumCandidates
                    )
                )
                if arguments.delayMilliseconds > 0 {
                    try await Task.sleep(
                        nanoseconds: arguments.delayMilliseconds * 1_000_000
                    )
                }
            }
            completed.append(CentreResult(centreId: record.id, searches: searches))
            try write(completed, to: arguments.output)
            fputs("[\(index + 1)/\(input.records.count)] searched \(record.id)\n", stderr)
        }
    }

    private static func search(
        _ query: PilotQuery,
        region: SearchRegion?,
        maximumCandidates: Int
    ) async -> SearchAttempt {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query.text
        if let region {
            request.region = MKCoordinateRegion(
                center: CLLocationCoordinate2D(
                    latitude: region.centerLatitude,
                    longitude: region.centerLongitude
                ),
                span: MKCoordinateSpan(
                    latitudeDelta: region.latitudeDelta,
                    longitudeDelta: region.longitudeDelta
                )
            )
            request.regionPriority = .required
        }

        do {
            let response = try await MKLocalSearch(request: request).start()
            let candidates = response.mapItems
                .prefix(maximumCandidates)
                .enumerated()
                .map { index, item in
                    SearchCandidate(
                        rank: index + 1,
                        name: item.name ?? "",
                        address: item.address?.fullAddress ?? "",
                        latitude: item.location.coordinate.latitude,
                        longitude: item.location.coordinate.longitude,
                        phone: item.phoneNumber,
                        url: item.url?.absoluteString
                    )
                }
            return SearchAttempt(
                kind: query.kind,
                query: query.text,
                candidates: candidates,
                error: nil
            )
        } catch {
            return SearchAttempt(
                kind: query.kind,
                query: query.text,
                candidates: [],
                error: String(describing: error)
            )
        }
    }

    private static func existingResults(at url: URL) throws -> [CentreResult] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let existing = try JSONDecoder().decode(
            PilotOutput.self,
            from: Data(contentsOf: url)
        )
        return existing.records
    }

    private static func write(_ records: [CentreResult], to url: URL) throws {
        let output = PilotOutput(
            version: 1,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            records: records
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(output)
        try data.write(to: url, options: .atomic)
    }

    private static func parseArguments() throws -> Arguments {
        let values = Array(CommandLine.arguments.dropFirst())
        func value(after flag: String) -> String? {
            guard let index = values.firstIndex(of: flag), index + 1 < values.count else {
                return nil
            }
            return values[index + 1]
        }
        guard let input = value(after: "--input") else {
            throw ArgumentError.message("--input is required")
        }
        guard let output = value(after: "--output") else {
            throw ArgumentError.message("--output is required")
        }
        let delay = UInt64(value(after: "--delay-ms") ?? "750")
        let maximumCandidates = Int(value(after: "--max-candidates") ?? "5")
        guard let delay, let maximumCandidates, maximumCandidates > 0 else {
            throw ArgumentError.message("invalid delay or candidate limit")
        }
        return Arguments(
            input: URL(fileURLWithPath: input),
            output: URL(fileURLWithPath: output),
            delayMilliseconds: delay,
            maximumCandidates: maximumCandidates
        )
    }
}

enum ArgumentError: Error {
    case message(String)
}
