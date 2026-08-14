export interface OptionMove {
	value: string;
	focusDelta: -1 | 0 | 1;
}

/** Move within a rendered option list, leaving the field past either edge. */
export function moveOption(choices: readonly string[], current: string, delta: -1 | 1): OptionMove {
	const index = Math.max(0, choices.indexOf(current));
	const next = index + delta;
	if (next < 0) return { value: choices[index] ?? current, focusDelta: -1 };
	if (next >= choices.length) return { value: choices[index] ?? current, focusDelta: 1 };
	return { value: choices[next]!, focusDelta: 0 };
}
