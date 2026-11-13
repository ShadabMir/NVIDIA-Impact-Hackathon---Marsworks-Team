// Plain-English summaries of what voice input understood (used on screen and for read-back).
export const formatDate = value => {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value
    : parsed.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

export function describeDetails(details) {
  const parts = [];
  if (details.date) parts.push(formatDate(details.date));
  if (details.arrival) parts.push(`arrive by ${details.arrival}`);
  if (details.department) parts.push(details.department);
  if (details.origin) parts.push(`travelling from ${details.origin}`);
  return parts.join(", ");
}
