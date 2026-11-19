/** Match score 0-10 as a ring (styles: .score-ring in job_list.css). */
import { scoreClass, scoreLabel, scorePercent } from "@/lib/tracker/format";

export function ScoreRing({ score, large = false }: { score: number | null; large?: boolean }) {
  const label = scoreLabel(score);
  const title = score === null ? "No AI match score yet" : `Match score ${label} of 10, from Run AI on this site`;
  return (
    <div className={`score-ring ${scoreClass(score)}${large ? " score-lg" : ""}`} role="img" aria-label={title} title={title}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="score-ring-track" cx="18" cy="18" r="15.5" fill="none" pathLength={100} />
        <circle
          className="score-ring-fill" cx="18" cy="18" r="15.5" fill="none" pathLength={100}
          strokeLinecap="round" strokeDasharray={`${scorePercent(score)} 100`}
        />
      </svg>
      <span className="score-ring-num">{label}</span>
    </div>
  );
}
