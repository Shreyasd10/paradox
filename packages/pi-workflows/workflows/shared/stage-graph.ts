export type SkillStageSpec = {
	id: string;
	skill: string;
	label: string;
	instructions: string;
	model?: string;
	maxTurns?: number;
};

export const LUNA_MEDIUM = "openai-codex/gpt-5.6-luna:medium";

const researchQuestions: SkillStageSpec = {
	id: "research-questions",
	skill: "create-research-questions",
	label: "Research questions",
	instructions: "Create the research-questions artifact for the task. Stay descriptive and do not propose implementation.",
};

const research: SkillStageSpec = {
	id: "research",
	skill: "create-research",
	label: "Research",
	instructions: "Complete the full research workflow and produce the required docs/research artifact grounded in the live codebase.",
};

const structureOutline: SkillStageSpec = {
	id: "structure-outline",
	skill: "create-structure-outline",
	label: "Structure outline",
	instructions: "Create and fully resolve the vertical implementation outline. Do not implement code.",
	model: LUNA_MEDIUM,
	maxTurns: 48,
};

const detailedPlan: SkillStageSpec = {
	id: "detailed-plan",
	skill: "create-plan",
	label: "Detailed implementation plan",
	instructions: "Convert the approved structure outline into the complete detailed implementation plan. Do not implement code.",
	model: LUNA_MEDIUM,
	maxTurns: 48,
};

const implementOutline: SkillStageSpec = {
	id: "implement-outline",
	skill: "implement-outline",
	label: "Outline implementation",
	instructions: "Implement every phase from the approved structure outline. Return an internal approval gate after each phase before advancing.",
	model: LUNA_MEDIUM,
	maxTurns: 64,
};

const implementPlan: SkillStageSpec = {
	id: "implement-plan",
	skill: "implement-plan",
	label: "Plan implementation",
	instructions: "Implement every phase from the approved detailed plan. Return an internal approval gate after each phase before advancing.",
	model: LUNA_MEDIUM,
	maxTurns: 64,
};

export function researchStages(enabled: boolean): SkillStageSpec[] {
	return enabled ? [researchQuestions, research] : [];
}

export function deliveryStages(detailed: boolean): SkillStageSpec[] {
	return detailed ? [detailedPlan, implementPlan] : [implementOutline];
}

export const sharedStructureOutline = structureOutline;
