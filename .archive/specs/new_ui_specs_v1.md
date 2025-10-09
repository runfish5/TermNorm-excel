# Themed Hybrid UI Component

## Core Purpose
Create a uniquely themed UI component that combines multiple existing UI elements into one elegant solution.

## Output Requirements
- **File Name**: `taskpane[iteration_number].html`
- **Template BluePrint**:
```html
<html>
  <body>

    <!-- HEADER PANEL (Always Visible) -->
    <header id="header-panel">
      [Server Status Indicator]      <!-- "Health LED + Quick Diagnostics" -->
      [Current Project Name]         <!-- "Active Configuration Display" -->
      [Global Actions]               <!-- "Start Tracking Button" -->
    </header>

    <!-- DYNAMIC CONTENT AREA (State-Based Views) -->
    <main id="content-area">

      <!-- TASK-ORIENTED TABS (Contextual Navigation) -->
      <nav id="view-tabs">
        [Setup Tab]                  <!-- "Configuration & Mapping Setup" -->
        [Results Tab]                <!-- "Primary View - Candidate Rankings" -->
        [History Icon]               <!-- "Compact History Access" -->
        [Settings Tab]               <!-- "API Keys & Advanced Config" -->
      </nav>

      <!-- SETUP VIEW (Progressive Configuration Flow) -->
      <section id="setup-view">
        [Config Upload Zone]         <!-- "File Drop Area + Progress" -->
        [Mapping Files Section]     <!-- "Sequential Mapping Setup" -->
        [Activation Controls]       <!-- "Validation + Start Process" -->
        [Progress Indicators]       <!-- "Clear Step-by-Step Status" -->
      </section>

      <!-- RESULTS VIEW (Primary Working Area - 95% Usage) -->
      <section id="results-view">
        [Candidate Rankings Table]   <!-- "Main Decision Interface" -->
        [Quick Actions Bar]         <!-- "Apply/Reject/Modify Controls" -->
        [Context Details Panel]     <!-- "Cell Info + Suggestions" -->
      </section>

      <!-- HISTORY VIEW (Compact Activity Log) -->
      <section id="history-view">
        [Activity Feed]             <!-- "Chronological Process Log" -->
        [Filter Controls]           <!-- "Date/Type/Status Filters" -->
      </section>

      <!-- SETTINGS VIEW (Grouped Configuration) -->
      <section id="settings-view">
        [API Configuration Group]   <!-- "Expandable API Settings" -->
        [Processing Options Group]  <!-- "Advanced Processing Config" -->
        [Display Preferences Group] <!-- "UI Theme + Display Options" -->
        [Theme Select Menu]         <!-- "Visual Theme Selector" -->
      </section>

    </main>

    <!-- FOOTER PANEL (Always Visible) -->
    <footer id="footer-panel">
      [Status Messages]            <!-- "Real-time Notifications" -->
      [Quick Log Access]           <!-- "Troubleshooting Link" -->
    </footer>

    <!-- CONTEXT-SENSITIVE OVERLAYS -->
    <div id="overlay-templates">
      [Loading States]             <!-- "Processing Indicators" -->
      [Error Dialogs]              <!-- "Contextual Error Messages" -->
      [Quick Help Tooltips]       <!-- "Progressive Disclosure Help" -->
    </div>

  </body>
</html>

```


## **Primary Architecture: Progressive Disclosure with State-Based Views**


### **Main Structure:**
1. **Header Panel** (Always Visible)
   - Server status indicator with quick diagnostics
   - Current project/configuration name
   - Global actions (Start tracking)

2. **Dynamic Content Area** with 4 main views:
   - **Setup View** (Configuration & Mapping)
      - Config file upload → Mapping files → Activation
      - Clear progress indicators
      - Validation feedback at each step
   - **History View** (history)
   - **Results View** (Candidate rankings)
   - **Settings View** (API keys, advanced config)
      - Grouped by function (API, Processing, Display)
      - Expandable advanced options
      - Theme select menu


3. **Footer Panel** (Always Visible)
   - Status messages and notifications
   - Quick access to logs/troubleshooting

### **Best UI Pattern: Task-Oriented Tabs**
- Users need see only results
- Use a icon for history so that tab is very small
- Excel taskpanes are narrow


### **Key UI Architecture Principles:**
- **Context-aware**: Show relevant controls based on current state
- **Progressive disclosure**: Hide complexity until needed
- **Status-driven**: UI adapts to whether system is idle, processing, or showing results
- **Quick actions**: "Rankings View" is shown 95% of time, and tasks accessible in 1-2 clicks


## Design Dimensions

### Theme Development Guide
**Primary Theme Selection**: Choose one distinctive visual/conceptual theme
- **Nature Themes**: Ocean depths, forest canopies, desert landscapes, arctic tundra
- **Era Themes**: Art deco, cyberpunk, steampunk, minimalist modern, brutalist
- **Conceptual Themes**: Data visualization, musical harmony, geometric abstraction, organic flow
- **Emotional Themes**: Serene calm, energetic dynamism, professional authority, playful creativity

**Theme Implementation Strategy**:
- **Color Psychology**: Use colors that reinforce your theme's emotional impact
- **Typography Selection**: Choose fonts that embody your theme's personality
- **Visual Metaphors**: Incorporate theme-related imagery, shapes, or patterns
- **Interaction Patterns**: Design hover, click, and transition effects that match your theme

### Combination Strategies
**Multi-Component Integration**: Select 2-4 UI components to combine
- **Input + Display**: Search bar + results grid, form + preview panel
- **Navigation + Content**: Sidebar menu + content area, tabs + panels
- **Control + Feedback**: Slider controls + visual output, buttons + status indicators
- **Data + Visualization**: Table + chart, timeline + details panel

**Integration Approaches**:
- **Nested Integration**: One component contains others (card containing form + preview)
- **Adjacent Integration**: Components sit side-by-side with shared styling
- **Layered Integration**: Components overlap or stack with z-index relationships
- **Flow Integration**: Components connect in a logical user workflow sequence

## Quality Standards

### Thematically Distinctive
- Every visual element should reinforce your chosen theme
- Color choices, typography, spacing, and imagery should create a cohesive aesthetic
- The theme should be immediately recognizable and memorable
- Avoid generic or bland design choices that could work with any theme

### Functionally Integrated
- Combined components should work together seamlessly
- User interactions should flow naturally between different component areas
- Data or state changes in one component should meaningfully affect others
- The combination should solve a real user problem more effectively than separate components

### Practically Superior
- The hybrid component should outperform using separate components
- Loading performance should be optimized for the combined functionality
- User workflow should be more efficient with the integrated approach
- Responsive design should work smoothly across device sizes

### Technically Excellent
- Clean, semantic HTML structure
- Efficient CSS with logical organization and reusable patterns
- Smooth animations and transitions that enhance rather than distract
- Accessible design with proper ARIA labels and keyboard navigation
- Cross-browser compatibility considerations

## Iteration Evolution

### Progressive Sophistication
- **Early Iterations**: Focus on solid theme establishment and basic component integration
- **Middle Iterations**: Add sophisticated interactions, micro-animations, and advanced styling
- **Later Iterations**: Explore cutting-edge CSS features, complex state management, innovative UX patterns

### Creative Exploration Paths
- **Theme Depth**: Push your chosen theme to more sophisticated or unexpected places
- **Component Complexity**: Combine more components or add more complex interactions
- **Technical Innovation**: Experiment with newer CSS features, creative layouts, advanced animations
- **User Experience**: Focus on perfecting the user journey and reducing cognitive load

## Ultra-Thinking Directive

### Innovation Requirements
Each iteration must introduce something genuinely new:
- **Unique Theme Application**: Apply your theme in ways not seen in previous iterations
- **Novel Component Combinations**: Try component pairings that haven't been explored
- **Creative Technical Solutions**: Use CSS or HTML in innovative, standards-compliant ways
- **Enhanced User Experience**: Solve usability challenges in fresh, intuitive ways

### Quality Amplification
- **Visual Impact**: Each iteration should be immediately impressive and memorable
- **Functional Elegance**: The component combination should feel inevitable and perfectly suited
- **Technical Craft**: Code quality should demonstrate mastery and attention to detail
- **User Delight**: Interactions should feel smooth, responsive, and satisfying

### Creative Pushing Boundaries
- Don't settle for obvious solutions - explore unexpected approaches
- Combine themes or create theme variations that add depth and interest
- Experiment with cutting-edge CSS features while maintaining broad compatibility
- Think about how your component could inspire or influence other designers

Remember: Your goal is to create UI components that are so well-designed and distinctive that they could serve as inspiration for other developers, demonstrate advanced frontend skills, and solve real-world interface challenges in elegant, themed ways.