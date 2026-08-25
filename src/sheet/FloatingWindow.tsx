import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const STORAGE_KEY = "sotsk-character-sheet-window";
const MIN_WIDTH = 480;
const MIN_HEIGHT = 420;
const DEFAULT_WIDTH = 780;
const DEFAULT_HEIGHT = 860;

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function loadGeometry(): Geometry {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Geometry>;
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.width === "number" &&
        typeof parsed.height === "number"
      ) {
        return parsed as Geometry;
      }
    }
  } catch {
    // ignore malformed/inaccessible storage, fall through to default
  }
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;
  return {
    x: Math.max(0, (window.innerWidth - width) / 2),
    y: Math.max(0, (window.innerHeight - height) / 2),
    width,
    height,
  };
}

function clampToViewport(geometry: Geometry): Geometry {
  const width = clamp(geometry.width, MIN_WIDTH, window.innerWidth);
  const height = clamp(geometry.height, MIN_HEIGHT, window.innerHeight);
  return {
    width,
    height,
    x: clamp(geometry.x, 0, Math.max(0, window.innerWidth - width)),
    y: clamp(geometry.y, 0, Math.max(0, window.innerHeight - height)),
  };
}

export function FloatingWindow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [geometry, setGeometry] = useState<Geometry>(() =>
    clampToViewport(loadGeometry())
  );
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(
    null
  );
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number } | null>(
    null
  );

  const persist = useCallback((next: Geometry) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // per-viewer convenience only; ignore storage failures
    }
  }, []);

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        const { offsetX, offsetY } = dragRef.current;
        setGeometry((prev) => {
          const width = prev.width;
          const height = prev.height;
          return {
            ...prev,
            x: clamp(e.clientX - offsetX, 0, Math.max(0, window.innerWidth - width)),
            y: clamp(e.clientY - offsetY, 0, Math.max(0, window.innerHeight - height)),
          };
        });
      } else if (resizeRef.current && resizeRef.current.pointerId === e.pointerId) {
        const { startX, startY, startWidth, startHeight } = resizeRef.current;
        setGeometry((prev) => {
          const width = clamp(
            startWidth + (e.clientX - startX),
            MIN_WIDTH,
            window.innerWidth - prev.x
          );
          const height = clamp(
            startHeight + (e.clientY - startY),
            MIN_HEIGHT,
            window.innerHeight - prev.y
          );
          return { ...prev, width, height };
        });
      }
    }

    function handlePointerUp(e: PointerEvent) {
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
        persist(geometryRef.current);
      }
      if (resizeRef.current?.pointerId === e.pointerId) {
        resizeRef.current = null;
        persist(geometryRef.current);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [persist]);

  useEffect(() => {
    function handleResize() {
      setGeometry((prev) => {
        const next = clampToViewport(prev);
        persist(next);
        return next;
      });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [persist]);

  const startDrag = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - geometryRef.current.x,
      offsetY: e.clientY - geometryRef.current.y,
    };
  }, []);

  const startResize = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: geometryRef.current.width,
      startHeight: geometryRef.current.height,
    };
  }, []);

  const dragging = dragRef.current !== null;

  return (
    <div
      className="floating-window"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <div
        className="floating-window-header"
        onPointerDown={startDrag}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <span className="floating-window-title">{title}</span>
        <button
          type="button"
          className="floating-window-close"
          onPointerDown={(e) => e.stopPropagation()}
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
