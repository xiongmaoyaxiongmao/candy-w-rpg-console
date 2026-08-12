import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FLOATING_TOGGLE_POSITION_STORAGE_KEY,
    clampFloatingTogglePosition,
    didFloatingToggleMove,
    parseFloatingTogglePosition,
    positionFromFloatingTogglePointer,
    serializeFloatingTogglePosition,
} from '../src/ui/floating-toggle-position.js';

const viewport = Object.freeze({ width: 1280, height: 800 });
const toggle = Object.freeze({ width: 45, height: 45 });
const inset = 12;

test('floating toggle position persists as a strict, portable pixel pair', () => {
    assert.equal(FLOATING_TOGGLE_POSITION_STORAGE_KEY, 'candy-w-rpg-director/floating-toggle-position/v1');
    const saved = serializeFloatingTogglePosition({ left: 421, top: 316 });
    assert.equal(saved, '{"left":421,"top":316}');
    assert.deepEqual(parseFloatingTogglePosition(saved), { left: 421, top: 316 });

    for (const invalid of [
        '',
        'null',
        '[]',
        '{"left":"421","top":316}',
        '{"left":421}',
        '{"left":421,"top":316,"right":10}',
        '{"left":null,"top":316}',
        '{"left":1e999,"top":316}',
    ]) {
        assert.equal(parseFloatingTogglePosition(invalid), null, `must reject ${invalid}`);
    }
});

test('floating toggle remains completely reachable after desktop viewport changes', () => {
    assert.deepEqual(
        clampFloatingTogglePosition({ left: 1168, top: 744 }, viewport, toggle, inset),
        { left: 1168, top: 743 },
    );
    assert.deepEqual(
        clampFloatingTogglePosition({ left: -25, top: 1000 }, viewport, toggle, inset),
        { left: 12, top: 743 },
    );
    assert.deepEqual(
        clampFloatingTogglePosition({ left: 421, top: 316 }, { width: 390, height: 844 }, toggle, inset),
        { left: 333, top: 316 },
    );
});

test('pointer positions move the toggle equivalently for mouse and touch input', () => {
    const grabOffset = { x: 36, y: 19 };
    const mouse = positionFromFloatingTogglePointer(
        { clientX: 700, clientY: 520, pointerType: 'mouse' },
        grabOffset,
        viewport,
        toggle,
        inset,
    );
    const touch = positionFromFloatingTogglePointer(
        { clientX: 700, clientY: 520, pointerType: 'touch' },
        grabOffset,
        viewport,
        toggle,
        inset,
    );
    assert.deepEqual(mouse, { left: 664, top: 501 });
    assert.deepEqual(touch, mouse);

    assert.deepEqual(
        positionFromFloatingTogglePointer({ clientX: -30, clientY: 999, pointerType: 'touch' }, grabOffset, viewport, toggle, inset),
        { left: 12, top: 743 },
    );
});

test('a real drag suppresses the following activation click, while a tap stays a click', () => {
    const origin = { clientX: 100, clientY: 200 };
    assert.equal(didFloatingToggleMove(origin, { clientX: 105, clientY: 203 }), false);
    assert.equal(didFloatingToggleMove(origin, { clientX: 106, clientY: 200 }), true);
    assert.equal(didFloatingToggleMove(origin, { clientX: 100, clientY: 206 }), true);
    assert.equal(didFloatingToggleMove(origin, { clientX: 106, clientY: 200 }, 7), false);
});
