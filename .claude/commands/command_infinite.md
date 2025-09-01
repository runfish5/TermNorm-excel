**INFINITE AGENTIC LOOP COMMAND**

Think deeply about this infinite generation task. You are about to embark on a sophisticated iterative creation process for easy testing by switching numbers in taskpane.js.

**Variables:**

spec_file: $ARGUMENTS
output_dir: $ARGUMENTS
count: $ARGUMENTS

**ARGUMENTS PARSING:**
Parse the following arguments from "$ARGUMENTS":
1. `spec_file` - Path to the markdown specification file
2. `output_dir` - Directory where iterations will be saved  
3. `count` - Number of iterations (1-N or "infinite")

**TASKPANE.JS TESTING INTEGRATION:**
Generated components must enable easy testing by simply changing a number in taskpane.js:

```javascript
// In taskpane.js - easy iteration switching
const TEST_ITERATION = 1; // Change this number to test different iterations

// Dynamic imports based on iteration number
import(`../generated-components/component_${TEST_ITERATION}.js`).then(module => {
  window.testComponent = new module.ComponentClass();
});
```

Each generated component must export this pattern:
```javascript
export class ComponentClass {
  static async initForTesting(containerId = 'test-container') {
    // Initialize component for testing
  }
  
  static cleanup() {
    // Clean up component when switching iterations
  }
}
```

**PHASE 1: SPECIFICATION ANALYSIS**
Read and deeply understand the specification file at `spec_file`. This file defines:
- What type of content to generate
- The format and structure requirements
- Any specific parameters or constraints
- The intended evolution pattern between iterations
- Integration requirements for taskpane.js testing

Think carefully about the spec's intent and how each iteration should build upon previous work while enabling easy testing through number switching.

**PHASE 2: OUTPUT DIRECTORY RECONNAISSANCE** 
Thoroughly analyze the `output_dir` to understand the current state:
- List all existing files and their naming patterns
- Identify the highest iteration number currently present
- Analyze the content evolution across existing iterations
- Understand the trajectory of previous generations
- Determine what gaps or opportunities exist for new iterations

**PHASE 3: ITERATION STRATEGY**
Based on the spec analysis and existing iterations:
- Determine the starting iteration number (highest existing + 1)
- Plan how each new iteration will be unique and evolutionary
- Consider how to build upon previous iterations while maintaining novelty
- Ensure all iterations support easy testing via number switching in taskpane.js
- If count is "infinite", prepare for continuous generation until context limits

**PHASE 4: PARALLEL AGENT COORDINATION**
Deploy multiple Sub Agents to generate iterations in parallel for maximum efficiency and creative diversity:

**Sub-Agent Distribution Strategy:**
- For count 1-5: Launch all agents simultaneously 
- For count 6-20: Launch in batches of 5 agents to manage coordination
- For "infinite": Launch waves of 3-5 agents, monitoring context and spawning new waves

**Agent Assignment Protocol:**
Each Sub Agent receives:
1. **Spec Context**: Complete specification file analysis
2. **Directory Snapshot**: Current state of output_dir at launch time
3. **Iteration Assignment**: Specific iteration number (starting_number + agent_index)
4. **Uniqueness Directive**: Explicit instruction to avoid duplicating concepts from existing iterations
5. **Quality Standards**: Detailed requirements from the specification
6. **Testing Integration**: Requirement to support easy testing by changing numbers in taskpane.js

**Agent Task Specification:**
```
TASK: Generate iteration [NUMBER] for [SPEC_FILE] in [OUTPUT_DIR]

You are Sub Agent [X] generating iteration [NUMBER]. 

CONTEXT:
- Specification: [Full spec analysis]
- Existing iterations: [Summary of current output_dir contents]
- Your iteration number: [NUMBER]
- Assigned creative direction: [Specific innovation dimension to explore]

REQUIREMENTS:
1. Read and understand the specification completely
2. Analyze existing iterations to ensure your output is unique
3. Generate content following the spec format exactly
4. Focus on [assigned innovation dimension] while maintaining spec compliance
5. Create file with exact name pattern specified
6. Ensure your iteration adds genuine value and novelty
7. CRITICAL: Enable easy testing by switching numbers in taskpane.js

DELIVERABLE: Single file as specified, with unique innovative content that supports easy testing integration
```

**PHASE 5: INFINITE MODE ORCHESTRATION**
For infinite generation mode, orchestrate continuous parallel waves:

**Wave-Based Generation:**
1. **Wave Planning**: Determine next wave size (3-5 agents) based on context capacity
2. **Agent Preparation**: Prepare fresh context snapshots for each new wave
3. **Progressive Sophistication**: Each wave should explore more advanced innovation dimensions
4. **Context Monitoring**: Track total context usage across all agents and main orchestrator
5. **Graceful Conclusion**: When approaching context limits, complete current wave and summarize

**EXECUTION PRINCIPLES:**

**Quality & Uniqueness:**
- Each iteration must be genuinely unique and valuable
- Build upon previous work while introducing novel elements
- Maintain consistency with the original specification
- Ensure proper file organization and naming
- Support easy testing through number switching in taskpane.js

**Parallel Coordination:**
- Deploy Sub Agents strategically to maximize creative diversity
- Assign distinct innovation dimensions to each agent to avoid overlap
- Coordinate timing to prevent file naming conflicts
- Monitor all agents for successful completion and quality

Begin execution with deep analysis and proceed systematically through each phase, leveraging Sub Agents for maximum creative output and efficiency while ensuring all components support easy testing integration.