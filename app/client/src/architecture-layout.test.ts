import { describe, expect, it } from 'vitest';

import { ARCHITECTURE_EDGES, ARCHITECTURE_NODES, nodesInLane } from './architecture';
import {
  BOTTOM_ROW_NODES,
  CANVAS_HEIGHT,
  CANVAS_MARGIN,
  CANVAS_MAX_WIDTH,
  CANVAS_WIDTH,
  COLUMN_GAP,
  LABEL_CLEAR_MIN,
  NODE_BOXES,
  ROW_GAP_MIN,
  canvasFits,
  canvasScale,
  columnStacks,
  crossingEdges,
  drawnEdges,
  drawnRects,
  edgeEntersCard,
  edgesThroughCards,
  fittedSpan,
  labelClearances,
  nodeBox,
  nodeHeight,
  overlappingNodes,
  overlappingRects,
  pathEnds,
  pathPoints,
  pathPolyline,
  pathsCross,
  rectGap,
  rectsOverlap,
  wrappedLines,
  type Rect,
} from './architecture-layout';

describe('every simplified node is placed once', () => {
  it('has exactly one box for every current node', () => {
    expect(Object.keys(NODE_BOXES).sort()).toEqual(ARCHITECTURE_NODES.map((node) => node.id).sort());
    for (const node of ARCHITECTURE_NODES) {
      expect(nodeBox(node.id), node.id).toBeDefined();
      expect(nodeHeight(node.id), node.id).toBe(NODE_BOXES[node.id].height);
    }
  });

  it('keeps every card inside the canvas', () => {
    for (const [id, box] of Object.entries(NODE_BOXES)) {
      expect(box.left, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(box.top, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width, `${id} right`).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(box.top + box.height, `${id} bottom`).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it('leaves enough vertical room between cards in each column', () => {
    for (const column of columnStacks()) {
      for (const card of column.cards) {
        if (card.gapAbove !== null) expect(card.gapAbove, card.id).toBeGreaterThanOrEqual(ROW_GAP_MIN);
      }
    }
    expect(overlappingNodes()).toEqual([]);
  });

  it('uses five evenly separated columns', () => {
    const columns = [...new Set(Object.values(NODE_BOXES).map((box) => box.left))].sort((a, b) => a - b);
    expect(columns).toHaveLength(5);
    for (let index = 1; index < columns.length; index += 1) {
      const previousWidth = Math.max(
        ...Object.values(NODE_BOXES)
          .filter((box) => box.left === columns[index - 1])
          .map((box) => box.width)
      );
      expect(columns[index] - columns[index - 1] - previousWidth).toBe(COLUMN_GAP);
    }
  });
});

describe('storage remains off the answer path', () => {
  it('derives the bottom row from the record lane', () => {
    expect([...BOTTOM_ROW_NODES].sort()).toEqual(
      nodesInLane('record')
        .map((node) => node.id)
        .sort()
    );
  });

  it('places each store below the component that writes it', () => {
    const stores = drawnEdges().filter((edge) => BOTTOM_ROW_NODES.includes(edge.to));
    expect(stores.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual([
      'agent-endpoint->experiment-id',
      'app->lakebase',
    ]);
    for (const edge of stores) {
      const ends = pathEnds(edge.d);
      expect(ends.end.y, edge.id).toBeGreaterThan(ends.start.y);
      expect(ends.end.x, edge.id).toBe(ends.start.x);
      expect(edge.accent, edge.id).toBe('kept');
    }
  });

  it('uses a straight vertical trace line', () => {
    const trace = drawnEdges().find((edge) => edge.from === 'agent-endpoint' && edge.to === 'experiment-id')!;
    expect(trace.d).toMatch(/^M [\d.]+ [\d.]+ V [\d.]+$/);
  });
});

describe('every current connection has valid geometry', () => {
  it('draws all model edges with unique ids and paths', () => {
    const edges = drawnEdges();
    expect(edges).toHaveLength(ARCHITECTURE_EDGES.length);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
    expect(new Set(edges.map((edge) => edge.d)).size).toBe(edges.length);
  });

  it('starts and ends on the two cards it joins', () => {
    const onBorder = (box: Rect, point: { x: number; y: number }) =>
      ((point.x === box.left || point.x === box.left + box.width) &&
        point.y >= box.top &&
        point.y <= box.top + box.height) ||
      ((point.y === box.top || point.y === box.top + box.height) &&
        point.x >= box.left &&
        point.x <= box.left + box.width);

    for (const edge of drawnEdges()) {
      const ends = pathEnds(edge.d);
      expect(onBorder(NODE_BOXES[edge.from], ends.start), `${edge.id} starts`).toBe(true);
      expect(onBorder(NODE_BOXES[edge.to], ends.end), `${edge.id} ends`).toBe(true);
      for (const value of pathPoints(edge.d)) {
        expect(value, edge.id).toBeGreaterThanOrEqual(0);
        expect(value, edge.id).toBeLessThanOrEqual(CANVAS_WIDTH);
      }
    }
  });

  it('crosses neither cards nor other edges', () => {
    expect(edgesThroughCards()).toEqual([]);
    expect(crossingEdges()).toEqual([]);
  });

  it('keeps all current relationships directional flows', () => {
    expect(drawnEdges().every((edge) => edge.relationship === 'flow')).toBe(true);
  });
});

describe('captions remain readable', () => {
  it('overlaps no card or other caption', () => {
    expect(overlappingRects()).toEqual([]);
    expect(drawnRects()).toHaveLength(ARCHITECTURE_NODES.length + ARCHITECTURE_EDGES.length);
  });

  it('leaves the minimum clearance at every scale', () => {
    const full = labelClearances();
    for (const entry of full) expect(entry.gap, entry.id).toBeGreaterThanOrEqual(LABEL_CLEAR_MIN);
    for (const scale of [0.71, 0.8, 1]) {
      const scaled = labelClearances(scale);
      for (const [index, entry] of scaled.entries()) {
        expect(entry.gap, entry.id).toBeCloseTo(full[index].gap * scale, 6);
      }
    }
  });

  it('uses relationship words rather than invented measurements', () => {
    for (const edge of drawnEdges()) {
      expect(edge.label, edge.id).not.toMatch(/\d/);
      expect(edge.label.length, edge.id).toBeLessThanOrEqual(16);
    }
  });
});

describe('the canvas fits its panel', () => {
  it('fits the widest panel and keeps equal outer margins', () => {
    expect(CANVAS_WIDTH).toBeLessThanOrEqual(CANVAS_MAX_WIDTH);
    const left = Math.min(...Object.values(NODE_BOXES).map((box) => box.left));
    const right = CANVAS_WIDTH - Math.max(...Object.values(NODE_BOXES).map((box) => box.left + box.width));
    expect(left).toBe(right);
    expect(Math.min(...Object.values(NODE_BOXES).map((box) => box.top))).toBe(CANVAS_MARGIN);
    expect(CANVAS_HEIGHT - Math.max(...Object.values(NODE_BOXES).map((box) => box.top + box.height))).toBe(
      CANVAS_MARGIN
    );
  });

  it('scales down with slack and stands down below its legibility floor', () => {
    expect(canvasScale(CANVAS_WIDTH)).toBe(1);
    expect(canvasScale(1100)).toBeLessThan(1);
    const span = fittedSpan(1100);
    expect(span.width).toBeLessThanOrEqual(1100);
    expect(span.left).toBeGreaterThan(0);
    expect(span.right).toBeLessThanOrEqual(1100);
    expect(canvasFits(1024)).toBe(true);
    expect(canvasFits(800)).toBe(false);
  });
});

describe('geometry helpers catch malformed layouts', () => {
  it('models wrapping without inventing empty lines', () => {
    expect(wrappedLines('one two three', 11, 0.58, 400)).toBe(1);
    expect(wrappedLines('one two three', 11, 0.58, 40)).toBe(3);
    expect(wrappedLines('unbreakablelongword', 11, 0.58, 10)).toBe(1);
  });

  it('detects rectangle overlap and measures separation', () => {
    const box: Rect = { left: 0, top: 0, width: 10, height: 10 };
    expect(rectsOverlap(box, { ...box, left: 5 })).toBe(true);
    expect(rectsOverlap(box, { ...box, left: 10 })).toBe(false);
    expect(rectGap(box, { ...box, left: 25 })).toBe(15);
    expect(rectGap(box, { ...box, left: 5 })).toBeNull();
  });

  it('detects lines through cards and crossing paths', () => {
    const box = NODE_BOXES['genie-data'];
    expect(edgeEntersCard(`M 0 ${box.top + 40} H ${CANVAS_WIDTH}`, box)).toBe(true);
    expect(edgeEntersCard(`M 0 ${box.top} H ${CANVAS_WIDTH}`, box)).toBe(false);
    expect(pathsCross('M 0 0 C 25 0 25 50 50 50', 'M 0 50 C 25 50 25 0 50 0')).toBe(true);
  });

  it('reads horizontal, vertical, and curved path endpoints', () => {
    expect(pathEnds('M 10 20 H 40')).toEqual({ start: { x: 10, y: 20 }, end: { x: 40, y: 20 } });
    expect(pathEnds('M 10 20 V 50')).toEqual({ start: { x: 10, y: 20 }, end: { x: 10, y: 50 } });
    expect(pathEnds('M 10 20 C 30 20 30 60 50 60')).toEqual({
      start: { x: 10, y: 20 },
      end: { x: 50, y: 60 },
    });
    expect(pathPolyline('M 10 20 V 50')).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 50 },
    ]);
  });
});
