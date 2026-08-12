import type { SkillStageSpec } from "../shared/stage-graph.js";
import { deliveryStages, researchStages, sharedStructureOutline } from "../shared/stage-graph.js";

const designDiscussion: SkillStageSpec = {
	id: "design-discussion",
	skill: "create-design-discussion",
	label: "Design discussion",
	instructions: "Run the complete design discussion, resolve every design question with the human, and produce the final approved design artifact.",
	maxTurns: 64,
};

export function rpiGraph(includeResearch: boolean, detailedPlan: boolean): SkillStageSpec[] {
	return [
		...researchStages(includeResearch),
		designDiscussion,
		sharedStructureOutline,
		...deliveryStages(detailedPlan),
	];
}
