import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

const ICON_SIZE = 15;

type Common = {
  icon: LucideIcon;
  // What the action does - shown as the hover/focus tooltip and used as
  // the accessible name, since the button itself has no visible text.
  label: string;
  // Overrides the tooltip text only (e.g. why a disabled action is
  // unavailable); the accessible name stays `label`.
  tooltip?: string;
  variant?: "danger" | "primary";
};

type Props = Common &
  (
    | { onClick: () => void; disabled?: boolean; to?: never }
    | { to: string; onClick?: never; disabled?: never }
  );

// Square icon-only action for table rows. Every table's row actions use
// this so they all look and behave the same - see .btn-icon in styles.css.
export default function IconButton({ icon: Icon, label, tooltip, variant, ...rest }: Props) {
  const className = `btn btn-sm btn-icon${variant ? ` btn-${variant}` : ""}`;
  const shared = { className, "aria-label": label, "data-tooltip": tooltip ?? label };

  if (rest.to !== undefined) {
    return (
      <Link {...shared} to={rest.to}>
        <Icon size={ICON_SIZE} />
      </Link>
    );
  }
  return (
    <button type="button" {...shared} disabled={rest.disabled} onClick={rest.onClick}>
      <Icon size={ICON_SIZE} />
    </button>
  );
}
