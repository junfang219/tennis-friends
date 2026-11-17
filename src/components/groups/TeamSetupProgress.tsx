export default function TeamSetupProgress({ step }: { step: 1 | 2 }) {
  return <ol aria-label="Team setup" className="grid grid-cols-2 gap-3 text-sm">{["Team details", "Invite players (optional)"].map((label, index) => <li key={label} aria-current={index + 1 === step ? "step" : undefined} className={`border-t-4 pt-2 ${index + 1 === step ? "border-court-green font-semibold text-court-green" : "border-gray-300 text-gray-600"}`}>{index + 1}. {label}</li>)}</ol>;
}
