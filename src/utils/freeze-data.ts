/** Freeze a graph of plain objects/arrays without invoking application policy. */
export function freezeData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new TypeError('freezeData accepts only plain data objects and arrays');
  seen.add(value);
  for (const child of Object.values(value)) freezeData(child, seen);
  return Object.freeze(value);
}
