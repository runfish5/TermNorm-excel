# TermNorm UI Component Generator - Infinite Agentic Loop Command

## Core Mission
Execute a sophisticated, AI-driven iterative generation process that produces multiple unique UI components specifically tailored for the TermNorm Excel Add-in project. This command orchestrates parallel Sub Agents to create genuinely diverse Office.js-compatible UI components while maintaining specification compliance and progressive sophistication.

## Command Signature
```
/project:infinite <spec_file> <output_dir> <count>
```

Where:
- `spec_file`: Path to the TermNorm UI specifications file
- `output_dir`: Directory where UI component iterations will be generated
- `count`: Number of iterations to generate (use "infinite" for continuous mode)

## TermNorm Project Context

### Architecture Integration Points
- **Office.js Compatibility**: All components must work within Office Add-in framework
- **State Management**: Components should integrate with existing StateManager
- **UI Manager Integration**: Components should be compatible with UIManager patterns
- **Excel Integration**: Components should leverage excel-integration.js services
- **Fabric UI Framework**: Components should use Microsoft Fabric UI styling conventions

### Existing Component Analysis
Based on project analysis, current components include:
- **ActivityFeedUI**: Live activity tracking tables
- **CandidateRankingUI**: Term matching candidate displays
- **MappingConfigModule**: Configuration module interfaces
- **TaskPane**: Main container with navigation and status bars
- **Drop Zones**: File configuration upload areas

## Easy Testing Integration

### TaskPane.js Integration Pattern
Generated components must include easy testing integration that allows switching between iterations by simply changing a number in the main application file.

#### Required Testing Infrastructure
Each generated component iteration must include:

1. **Numbered Import Pattern**: Components should be importable with simple number switching
```javascript
// In taskpane.js - easy iteration switching
const TEST_ITERATION = 1; // Change this number to test different iterations

// Dynamic imports based on iteration number
import(`../generated-components/component_${TEST_ITERATION}.js`).then(module => {
  window.testComponent = new module.ComponentClass();
});
```

2. **Initialization Hook**: Components must provide a standardized initialization method
```javascript
// Each generated component must export this pattern
export class ComponentClass {
  static async initForTesting(containerId = 'test-container') {
    // Initialize component for testing
  }
  
  static cleanup() {
    // Clean up component when switching iterations
  }
}
```

3. **Test Container Integration**: Components should integrate with existing taskpane structure
```javascript
// Generated components must work within existing DOM structure
// Example integration in taskpane.js:
if (window.TESTING_MODE) {
  const testContainer = document.createElement('div');
  testContainer.id = 'iteration-test-container';
  document.getElementById('app-body').appendChild(testContainer);
  
  // Load test component
  const iterationNumber = window.TEST_ITERATION || 1;
  import(`../generated-components/iteration_${iterationNumber}.js`).then(module => {
    module.default.init('iteration-test-container');
  });
}
```

4. **Hot-Swap Capability**: Support for switching iterations without full page reload
```javascript
// Utility for easy iteration switching in console
window.switchIteration = async (number) => {
  if (window.currentTestComponent) {
    window.currentTestComponent.cleanup();
  }
  
  const module = await import(`../generated-components/iteration_${number}.js`);
  window.currentTestComponent = new module.ComponentClass();
  await window.currentTestComponent.init('test-container');
};
```

### Testing Mode Activation
Each generated component must support a simple testing activation pattern:

```javascript
// Add to taskpane.js for easy testing
const ENABLE_COMPONENT_TESTING = true; // Toggle testing mode
const COMPONENT_ITERATION_TO_TEST = 1;   // Change number to test different iterations

if (ENABLE_COMPONENT_TESTING) {
  // Dynamically load and test the specified iteration
  import(`../generated-components/test_component_${COMPONENT_ITERATION_TO_TEST}.js`)
    .then(module => {
      window.testComponent = module.default;
      return module.default.init();
    })
    .catch(console.error);
}
```

## Execution Phases

### Phase 1: Application Integration Analysis
- **Deep Read**: Thoroughly analyze the provided TermNorm UI specification file
- **Requirements Extraction**: Identify Office.js constraints and Excel integration needs
- **Quality Benchmarks**: Establish success criteria specific to Excel Add-ins
- **Integration Points**: Understand existing component interfaces and state management
- **Office Design Language**: Ensure compliance with Microsoft Office design standards

### Phase 2: TermNorm Output Directory Reconnaissance
- **Directory Assessment**: Examine the target output directory within TermNorm structure
- **Existing Component Analysis**: If iterations already exist, analyze them for:
  - Office.js integration patterns
  - StateManager usage patterns
  - Fabric UI implementation approaches  
  - Excel API usage patterns
  - UIManager integration methods
- **Gap Analysis**: Identify missing component types in the current ecosystem
- **Iteration Strategy**: Develop strategy that complements existing TermNorm components

### Phase 3: TermNorm-Specific Iteration Strategy Development
For each iteration to be generated:

#### Strategic Planning
- **Office.js Integration**: Define Excel API integration requirements
- **State Management**: Plan StateManager integration patterns
- **UI Framework Alignment**: Ensure Fabric UI component consistency
- **Excel Workflow Integration**: Plan integration with terminology normalization workflow
- **User Experience Continuity**: Maintain consistency with existing TermNorm UX patterns

#### Quality Assurance Framework
- **Office.js Compatibility**: Verify all components work within Excel Add-in constraints
- **State Integration**: Ensure proper StateManager and UIManager integration
- **Performance Standards**: Maintain Excel Add-in performance requirements
- **Accessibility Standards**: Follow Office accessibility guidelines
- **Design System Compliance**: Adhere to Microsoft Office design language

### Phase 4: TermNorm Parallel Agent Coordination
Execute generation using TermNorm-aware parallel coordination:

#### TermNorm-Specific Sub Agent Instructions
For each Sub Agent tasked with generating a TermNorm component iteration:

```
You are a Sub Agent in a TermNorm Excel Add-in component generation system. Your mission is to create iteration #{iteration_number} based on the TermNorm UI specifications.

**TermNorm Context**: You are creating components for an AI-powered terminology standardization Excel Add-in. The system helps users normalize terminology in Excel worksheets through real-time tracking, AI-powered matching, and configuration management.

**Your Unique Creative Mission**: {Dynamically generated creative focus aligned with TermNorm workflows}

**Office.js Integration Requirements**: 
- Must work within Excel Add-in taskpane environment
- Should leverage Excel API for worksheet interactions
- Must handle Office.js initialization and Excel.run() patterns
- Should integrate with existing excel-integration.js services

**State Management Requirements**:
- Must integrate with existing StateManager (state.manager.js)
- Should follow StateManager subscription patterns for reactive updates
- Must coordinate with UIManager for event handling
- Should maintain state consistency across component lifecycle

**Fabric UI Standards**:
- Use Microsoft Fabric UI classes and patterns (ms-Button, ms-welcome, etc.)
- Follow existing CSS naming conventions from taskpane.css
- Maintain visual consistency with current TermNorm components
- Support responsive design for various taskpane sizes

**TermNorm Workflow Integration**:
- Components should enhance terminology normalization workflows
- Should support configuration management patterns
- Must integrate with live tracking and activity logging
- Should complement existing drag-drop configuration features

**Easy Testing Requirements**: 
- Must include numbered component exports for easy switching (e.g., component_1.js, component_2.js)
- Must provide standardized init() and cleanup() methods
- Should integrate with simple number-based testing patterns
- Must support hot-swapping without full application restart
- Should work with minimal changes to taskpane.js (just changing a number)

**Uniqueness Imperative**: This iteration must be genuinely unique while maintaining TermNorm ecosystem compatibility.

**Quality Standards**: Deliver production-ready code that demonstrates both Office.js expertise and TermNorm workflow understanding.
```

### Phase 5: TermNorm Infinite Mode Orchestration
When count is set to "infinite":

#### Continuous TermNorm Generation Logic
- **Perpetual Workflow Assessment**: Continuously evaluate TermNorm workflow gaps
- **Dynamic Component Strategy**: Adapt generation based on evolving Excel integration needs
- **Office.js Evolution Tracking**: Stay current with Office.js API developments
- **User Feedback Integration**: Incorporate TermNorm user experience insights

## TermNorm-Specific Quality Metrics

### Per-Component Assessment
- **Office.js Integration**: Seamless Excel Add-in functionality
- **StateManager Integration**: Proper reactive state management
- **TermNorm Workflow Enhancement**: Improves terminology normalization processes
- **Fabric UI Compliance**: Consistent with Microsoft Office design language
- **Performance Standards**: Meets Excel Add-in performance expectations

### TermNorm Ecosystem Assessment
- **Component Cohesion**: How well new components integrate with existing ones
- **Workflow Completeness**: Coverage of terminology normalization use cases
- **User Experience Flow**: Smooth integration with existing TermNorm UX patterns
- **Technical Debt Management**: Clean integration without architectural conflicts

## TermNorm Implementation Notes

### Office.js Specific Considerations
- **Excel API Limitations**: Respect Office.js API constraints and capabilities
- **Taskpane Environment**: Design for narrow taskpane layout constraints
- **Performance Optimization**: Minimize Excel API calls and optimize for responsiveness
- **Error Handling**: Robust error handling for Office.js integration failures
- **Version Compatibility**: Ensure compatibility across Office.js versions

### TermNorm Architecture Alignment
- **Component Registration**: Follow UIManager component registration patterns
- **State Subscription**: Use StateManager reactive patterns consistently
- **Event Handling**: Leverage existing event delegation systems
- **Configuration Integration**: Support drag-drop and dynamic configuration patterns
- **Activity Logging**: Integrate with existing activity logging systems

This command represents the pinnacle of Office.js Add-in component creation, specifically designed to explore the full potential of TermNorm's terminology normalization workflows while maintaining the highest standards of Excel integration and user experience consistency.