export function OneSkillRetakeOnlyNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={
        compact
          ? 'text-xs text-muted'
          : 'rounded-lg border border-line bg-surface p-3 text-sm text-muted'
      }
    >
      IELTS.org lists this as a One Skill Retake venue but does not publish a full IELTS
      Academic or General Training test here. Use your result portal or contact your original
      test centre to confirm eligibility and booking.
    </p>
  );
}
