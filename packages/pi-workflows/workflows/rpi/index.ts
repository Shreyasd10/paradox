import { Type } from "typebox";
import { workflow } from "../../src/authoring/workflow.js";
import { createDeliveryHost, runDeliveryGraph } from "../shared/verbatim-skill-runner.js";
import { rpiGraph } from "./graph.js";

export default workflow({
	name: "RPI",
	description:
		"First-class research/design/outline/implementation workflow with verbatim skill contracts, pi-task delegation, human review gates, and bounded fresh-session handoffs.",
	inputs: {
		task: Type.String({ description: "Task description or path to the task context." }),
		include_research: Type.Boolean({ default: false, description: "Run research questions and research before design." }),
		detailed_plan: Type.Boolean({ default: false, description: "Use create-plan and implement-plan after the outline." }),
		iteration_context: Type.Optional(
			Type.Union([Type.Literal("fresh"), Type.Literal("fork")], {
				description:
					'Default "fresh" starts each human turn in a clean session grounded by validated bounded handoffs. "fork" preserves the matching logical-stage transcript as a transitional rollback.',
			}),
		),
	},
	outputs: {
		status: Type.Union([Type.Literal("completed"), Type.Literal("blocked")]),
		completed_stages: Type.Array(Type.String()),
		reason: Type.Optional(Type.String()),
	},
	run: async (ctx) => {
		const host = await createDeliveryHost(ctx, "rpi");
		return runDeliveryGraph(host, rpiGraph(ctx.inputs.include_research === true, ctx.inputs.detailed_plan === true));
	},
});
