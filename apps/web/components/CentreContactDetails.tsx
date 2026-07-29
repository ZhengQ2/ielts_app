import type { Centre } from '@ielts-map/core';
import { isHttpUrl } from '@/lib/url-safety';

export function CentreContactDetails({ centre }: { centre: Centre }) {
  const contact = centre.contact ?? {
    phones: centre.phone ? [centre.phone] : [],
    emails: [],
    websites: [],
  };
  const websites = contact.websites.filter(isHttpUrl);
  const empty =
    contact.phones.length === 0 &&
    contact.emails.length === 0 &&
    websites.length === 0;

  if (empty) return <>—</>;

  return (
    <ul className="space-y-1">
      {contact.phones.map((phone) => (
        <li key={`phone-${phone}`}>
          <span className="text-muted">Phone: </span>
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="break-words hover:underline">
            {phone}
          </a>
        </li>
      ))}
      {contact.emails.map((email) => (
        <li key={`email-${email}`}>
          <span className="text-muted">Email: </span>
          <a href={`mailto:${email}`} className="break-all hover:underline">
            {email}
          </a>
        </li>
      ))}
      {websites.map((website) => (
        <li key={`website-${website}`}>
          <span className="text-muted">Website: </span>
          <a
            href={website}
            target="_blank"
            rel="noreferrer nofollow"
            className="break-all hover:underline"
          >
            {website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
          </a>
        </li>
      ))}
    </ul>
  );
}
