import { activeCentres } from '@ielts-map/core/dataset';
import { Directory } from '@/components/Directory';

export default function HomePage() {
  return <Directory centres={activeCentres} />;
}
