import type { SkillStageSpec } from "../shared/stage-graph.js";
import { deliveryStages, researchStages, sharedStructureOutline } from "../shared/stage-graph.js";

const productRequirements: SkillStageSpec = {
	id: "product-requirements",
	skill: "create-prd",
	label: "Product requirements",
	instructions: "Run the complete guided PRD interview, settle the foundation and solution one decision at a time, and produce the approved PRD artifact.",
	maxTurns: 64,
};

const technicalDesign: SkillStageSpec = {
	id: "technical-design",
	skill: "create-technical-design",
	label: "Technical design",
	instructions: "Run the complete System Design and Program Design interviews. Require an internal human approval gate after System Design before opening Program Design.",
	maxTurns: 96,
};

export function prdOrientedGraph(includeResearch: boolean, detailedPlan: boolean): SkillStageSpec[] {
	return [
		...researchStages(includeResearch),
		productRequirements,
		technicalDesign,
		sharedStructureOutline,
		...deliveryStages(detailedPlan),
	];
}
