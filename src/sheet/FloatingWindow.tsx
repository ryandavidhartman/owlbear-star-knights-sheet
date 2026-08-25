import {
  ReactNode,
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 420;

interface ResizeState {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

/**
 * Chrome-less window drawn inside an Owlbear popover. The popover itself
 * has no title bar or resize handle (Owlbear draws none for extension
 * content), so this supplies both: a header for the title/close button,
 * and a corner grip that resizes the *popover's own footprint* via
 * `onResize` -- OBR.popover.setWidth/setHeight -- rather than just
 * resizing content inside a fixed box.
 */
export function FloatingWindow({
  title,
  onClose,
  onResize,
  children,
}: {
  title: string;
  onClose: () => void;
  onResize: (width: number, height: number) => void;
  children: ReactNode;
}) {
  const resizeRef = useRef<ResizeState | null>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const state = resizeRef.current;
      if (!state || state.pointerId !== e.pointerId) {
        return;
      }
      const width = Math.max(MIN_WIDTH, state.startWidth + (e.clientX - state.startX));
      const height = Math.max(MIN_HEIGHT, state.startHeight + (e.clientY - state.startY));
      onResize(width, height);
    },
    [onResize]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (resizeRef.current?.pointerId !== e.pointerId) {
        return;
      }
      resizeRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    },
    [handlePointerMove]
  );

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      resizeRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: window.innerWidth,
        startHeight: window.innerHeight,
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [handlePointerMove, handlePointerUp]
  );

  return (
    <div className="floating-window">
      <div className="floating-window-header">
        <span className="floating-window-title">{title}</span>
        <button
          type="button"
          className="floating-window-close"
          onClick={onClose}
          aria-label="Close character sheet"
        >
          ✕
        </button>
      </div>
      <div className="floating-window-body">{children}</div>
      <div
        className="floating-window-resize-handle"
        onPointerDown={startResize}
        aria-hidden="true"
      />
    </div>
  );
}
