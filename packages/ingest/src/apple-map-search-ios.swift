import Darwin
import Foundation
import MapKit
import SwiftUI

struct PilotInput: Decodable {
    let records: [PilotRecord]
    let delayMilliseconds: UInt64?
    let maximumCandidates: Int?
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

@main
struct AppleMapAuditApp: App {
    var body: some Scene {
        WindowGroup {
            AuditView()
        }
    }
}

struct AuditView: View {
    @State private var status = "Preparing Apple Maps audit…"

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(status)
                .multilineTextAlignment(.center)
                .padding()
        }
        .task {
            do {
                try await runAudit()
                status = "Audit complete"
                try? await Task.sleep(nanoseconds: 500_000_000)
                Darwin.exit(0)
            } catch {
                status = "Audit failed: \(error)"
                fputs("AUDIT_FAILED \(error)\n", stderr)
                try? await Task.sleep(nanoseconds: 500_000_000)
                Darwin.exit(1)
            }
        }
    }

    @MainActor
    private func runAudit() async throws {
        guard let inputURL = Bundle.main.url(
            forResource: "apple-map-pilot-input",
            withExtension: "json"
        ) else {
            throw AuditError.message("Bundled pilot input is missing")
        }
        let input = try JSONDecoder().decode(
            PilotInput.self,
            from: Data(contentsOf: inputURL)
        )
        let outputURL = try outputFile()
        var completed = try existingResults(at: outputURL)
        let completedIds = Set(completed.map(\.centreId))
        let delay = input.delayMilliseconds ?? 750
        let maximumCandidates = input.maximumCandidates ?? 5

        for (index, record) in input.records.enumerated() {
            status = "Checking \(index + 1) of \(input.records.count)"
            if completedIds.contains(record.id) { continue }
            var searches: [SearchAttempt] = []
            for query in record.queries {
                searches.append(
                    await search(
                        query,
                        region: record.searchRegion,
                        maximumCandidates: maximumCandidates
                    )
                )
                if delay > 0 {
                    try await Task.sleep(nanoseconds: delay * 1_000_000)
                }
            }
            completed.append(CentreResult(centreId: record.id, searches: searches))
            try write(completed, to: outputURL)
        }
        fputs("AUDIT_COMPLETE records=\(completed.count)\n", stderr)
    }

    private func search(
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
                        address: item.placemark.title ?? "",
                        latitude: item.placemark.coordinate.latitude,
                        longitude: item.placemark.coordinate.longitude,
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

    private func outputFile() throws -> URL {
        let directory = try FileManager.default.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return directory.appendingPathComponent("apple-map-pilot-raw-ios.json")
    }

    private func existingResults(at url: URL) throws -> [CentreResult] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode(
            PilotOutput.self,
            from: Data(contentsOf: url)
        ).records
    }

    private func write(_ records: [CentreResult], to url: URL) throws {
        let output = PilotOutput(
            version: 1,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            records: records
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(output).write(to: url, options: .atomic)
    }
}

enum AuditError: Error {
    case message(String)
}
