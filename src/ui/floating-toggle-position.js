export const FLOATING_TOGGLE_POSITION_STORAGE_KEY = 'candy-w-rpg-director/floating-toggle-position/v1';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function validPosition(value) {
    return isRecord(value)
        && Object.keys(value).length === 2
        && own(value, 'left')
        && own(value, 'top')
        && Number.isFinite(value.left)
        && Number.isFinite(value.top);
}

function positiveNumber(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} 必须是非负有限数字。`);
    return value;
}

function viewportBounds(viewport, toggle, inset) {
    const width = positiveNumber(viewport?.width, '视口宽度');
    const height = positiveNumber(viewport?.height, '视口高度');
    const toggleWidth = positiveNumber(toggle?.width, '入口宽度');
    const toggleHeight = positiveNumber(toggle?.height, '入口高度');
    const safeInset = positiveNumber(inset, '边距');
    const availableWidth = Math.max(0, width - toggleWidth);
    const availableHeight = Math.max(0, height - toggleHeight);
    return {
        minLeft: Math.min(safeInset, availableWidth),
        maxLeft: Math.max(Math.min(safeInset, availableWidth), availableWidth - safeInset),
        minTop: Math.min(safeInset, availableHeight),
        maxTop: Math.max(Math.min(safeInset, availableHeight), availableHeight - safeInset),
    };
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function parseFloatingTogglePosition(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
        const value = JSON.parse(raw);
        return validPosition(value) ? { left: value.left, top: value.top } : null;
    } catch {
        return null;
    }
}

export function serializeFloatingTogglePosition(position) {
    if (!validPosition(position)) throw new TypeError('入口位置必须是严格的 left/top 坐标。');
    return JSON.stringify({ left: position.left, top: position.top });
}

export function clampFloatingTogglePosition(position, viewport, toggle, inset = 12) {
    if (!validPosition(position)) throw new TypeError('入口位置必须是严格的 left/top 坐标。');
    const bounds = viewportBounds(viewport, toggle, inset);
    return {
        left: Math.round(clamp(position.left, bounds.minLeft, bounds.maxLeft)),
        top: Math.round(clamp(position.top, bounds.minTop, bounds.maxTop)),
    };
}

export function positionFromFloatingTogglePointer(pointer, grabOffset, viewport, toggle, inset = 12) {
    if (!Number.isFinite(pointer?.clientX) || !Number.isFinite(pointer?.clientY)
        || !Number.isFinite(grabOffset?.x) || !Number.isFinite(grabOffset?.y)) {
        throw new TypeError('拖动入口需要有效的指针与抓取坐标。');
    }
    return clampFloatingTogglePosition({
        left: pointer.clientX - grabOffset.x,
        top: pointer.clientY - grabOffset.y,
    }, viewport, toggle, inset);
}

export function didFloatingToggleMove(start, end, threshold = 6) {
    if (!Number.isFinite(start?.clientX) || !Number.isFinite(start?.clientY)
        || !Number.isFinite(end?.clientX) || !Number.isFinite(end?.clientY)
        || !Number.isFinite(threshold) || threshold < 0) return false;
    return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) >= threshold;
}
