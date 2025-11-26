# Design Guidelines: Semantic Bleacher App

## Design Approach
**Design System:** Inspired by Linear's precision and VS Code's text-focused efficiency, creating a professional text processing utility with clean, functional aesthetics.

**Core Principle:** Maximize readability and operational clarity for intensive text work. This is a productivity tool where every pixel serves the user's workflow.

---

## Typography

**Font Stack:**
- Primary: Inter (via Google Fonts CDN) - body text, UI elements
- Monospace: JetBrains Mono - text areas, file names, technical elements

**Scale:**
- Headings: font-semibold text-lg (panel titles)
- Body/UI: font-medium text-sm (buttons, labels)
- Text areas: font-mono text-sm leading-relaxed
- Helper text: text-xs (file upload hints, status messages)

---

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 3, 4, 6, 8, 12
- Micro spacing: p-2, gap-2 (button groups, icon spacing)
- Standard spacing: p-4, gap-4 (panel padding, control groups)
- Section spacing: p-6, p-8 (panel headers)
- Large spacing: p-12 (outer container padding)

**Grid Structure:**
- Two-column split: 1fr | 1fr (input panel | output panel)
- Thin vertical divider between panels (border-r)
- Fixed header with app title and global controls
- Panels fill remaining viewport height (h-[calc(100vh-80px)])

---

## Component Library

### Text Areas
- Full-height within panels with scrollable overflow
- Monospace font for precise character/line tracking
- Generous padding (p-6) for comfortable reading
- Rounded corners (rounded-lg) on containers
- Focus states with subtle border treatment

### File Upload Zone
- Drag-and-drop target area with dashed border
- Center-aligned upload icon (use Heroicons: ArrowUpTrayIcon)
- Two-line text: "Drag .txt file here" + "or click to browse"
- File picker button integrated inline
- Active drag state with visual feedback
- Small file badge showing uploaded filename

### Bleaching Level Selector
- Radio button group with clear visual hierarchy
- Vertical stack for all four options
- "Heavy" option pre-selected with distinct visual treatment
- Labels: Light, Moderate, Heavy, Very Heavy
- Grouped with subtle border container

### Buttons
**Primary Action ("Bleach Text"):**
- Large, full-width button below input controls
- Substantial height (h-12)
- Font-semibold text-base
- Rounded-lg corners

**Secondary Actions (Copy, Download, Clear buttons):**
- Compact size (h-9)
- Icon + text labels (use Heroicons: ClipboardDocumentIcon, ArrowDownTrayIcon, XMarkIcon)
- Grouped horizontally with gap-2

**Button Layout:**
- Output controls: Horizontal row (flex gap-2) in top-right of output panel
- Clear All: Positioned in top-right of fixed header

### Panel Headers
- Sticky positioning at top of each panel
- Panel title (left-aligned, font-semibold text-lg)
- Controls row (right-aligned)
- Bottom border for visual separation
- Height: h-14, padding: px-6

### Status Indicators
- Small toast/badge for "Copied to clipboard" confirmation
- Processing state during API call (subtle loading indicator)
- Error messages for invalid input or API failures

---

## Layout Details

**Application Container:**
- Max-width: full viewport (w-screen)
- Fixed header: h-20 with horizontal padding px-12
- App title: left-aligned, text-xl font-bold
- Clear All button: right-aligned in header

**Input Panel (Left):**
- Top section: File upload zone (h-32)
- Middle section: Text area (flex-1)
- Bottom section: Bleaching level selector + Bleach button (h-48)
- Vertical flow with gap-6

**Output Panel (Right):**
- Top section: Panel header with controls (h-14)
- Main section: Read-only text area (flex-1)
- Empty state: Center-aligned placeholder text when no output

**Divider:**
- 1px vertical line separating panels
- Full height from header to bottom
- Subtle treatment to avoid distraction

---

## Interaction Patterns

**File Upload:**
- Hover state on upload zone
- Drag-over visual feedback (border style change)
- File name display after upload with small X to remove
- Clear button removes file and empties input textarea

**Text Processing:**
- Bleach button disabled when input is empty
- Loading state during API processing
- Smooth transition when output appears
- Auto-scroll output to top when new content loads

**Copy/Download:**
- Single-click copy with immediate confirmation feedback
- Download triggers browser download with smart filename
- Buttons disabled when output is empty

---

## Accessibility

- All interactive elements keyboard navigable
- Focus indicators on all controls
- ARIA labels for icon-only buttons
- Clear visual hierarchy for screen readers
- Sufficient color contrast for all text (when colors applied later)
- File input properly associated with drag-drop zone

---

## Images
**No images required** - This is a text-focused utility application with no hero section or decorative imagery. All visual elements are functional UI components.