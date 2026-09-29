// The three numbers under the identity block: level, current streak, trophies.
//
// Each cell carries its own context (tier and XP to go, "day streak",
// "trophies") so no figure sits in a box on its own. A cell with nothing
// behind it is dropped rather than drawn as a zero: a "0 day streak" on
// someone's public page reads as a failure they did not commit, and on
// another athlete's page it can mean "hidden" just as easily as "none".
// Equal flex cells rather than a grid, so two cells centre as cleanly as
// three and there is never a dead column.
export default function ProfileScoreboard({ cells }) {
  const shown = (cells || []).filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div className="flex border-y border-border py-4">
      {shown.map((cell, i) => (
        <div
          key={cell.id}
          className={`flex-1 min-w-0 flex flex-col items-center gap-1 px-2 text-center ${i ? 'border-s border-border' : ''}`}
        >
          <span className="font-display text-2xl tabular-nums">{cell.value}</span>
          <span className="text-xs text-muted-foreground leading-tight">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}
