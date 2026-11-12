import maskUrl from "../../../../veniron/mascara.svg?url";

/** How the mask looks. The artwork is `veniron/mascara.svg`, used as-is. */
export type RoseMood =
	| "idle"
	| "thinking"
	| "working"
	| "needs"
	| "restarting"
	| "offline"
	| "control"
	| "panic";

/**
 * The desktop orb: the V mask, with a bone-white glow while it works and a red one
 * when computer control has just been stopped (⌥⇧Esc or Parar).
 */
export function Rose({ mood }: { mood: RoseMood }) {
	return (
		<span className={`rose rose-${mood}`} aria-hidden="true">
			<img className="rose-mask" src={maskUrl} alt="" draggable={false} />
		</span>
	);
}
