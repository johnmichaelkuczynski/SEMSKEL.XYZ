# Semantic Bleacher App

## Overview

The Semantic Bleacher App is a professional text processing utility that "semantically bleaches" text by replacing semantic content words with placeholder variables while preserving exact syntax, punctuation, and grammatical structure. The application provides four levels of bleaching intensity (Light, Moderate, Heavy, Very Heavy) and uses AI to perform intelligent word substitution while maintaining the original text's structural integrity.

## Current Status (November 26, 2025)

**MVP COMPLETE AND WORKING**

All core features implemented and tested:
- Split-panel UI with professional design (VS Code-inspired aesthetic)
- Text input via typing, pasting, or drag-and-drop .txt file upload
- Four bleaching levels: Light, Moderate, Heavy (default), Very Heavy
- Anthropic Claude integration via Replit AI Integrations (no API key needed, billed to credits)
- Output operations: Copy to clipboard, Download as .txt, Clear
- Proper error handling with toast notifications
- Loading states during bleaching operations

**Recent Fixes:**
- Fixed API response parsing (apiRequest returns Response object that must be parsed with .json())
- Activated Anthropic AI Integration for bleaching functionality
- All end-to-end tests passing

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript, using Vite as the build tool and development server.

**UI Component System**: Utilizes shadcn/ui components built on Radix UI primitives, providing a comprehensive set of accessible, customizable components. The design system follows a Linear/VS Code-inspired aesthetic focusing on precision, readability, and text-focused efficiency.

**Styling Approach**: Tailwind CSS with custom theming through CSS variables. The design uses a "New York" style variant with careful attention to typography (Inter for UI, JetBrains Mono for code/monospace elements) and consistent spacing primitives.

**State Management**: React Query (@tanstack/react-query) for server state management, providing efficient caching, background refetching, and optimistic updates.

**Routing**: Wouter for lightweight client-side routing.

**Layout Structure**: Two-column split interface (input panel | output panel) with fixed header and panels that fill remaining viewport height. This maximizes screen real estate for intensive text work.

### Backend Architecture

**Server Framework**: Express.js running on Node.js with TypeScript.

**API Design**: RESTful API with a single main endpoint (`POST /api/bleach`) that accepts text, bleaching level, and optional filename. The endpoint validates input, enforces a 50,000 character limit, and returns bleached text.

**Request/Response Handling**: Uses Zod schemas for runtime validation of request and response data, ensuring type safety and data integrity across the client-server boundary.

**Development vs Production**: Separate entry points (`index-dev.ts` and `index-prod.ts`) with Vite middleware integration in development for hot module replacement and static file serving in production.

**Error Handling**: Centralized error handling with appropriate HTTP status codes and user-friendly error messages.

### Data Storage Solutions

**Primary Storage**: Currently uses in-memory storage (`MemStorage` class) for user data, suitable for development and lightweight deployments.

**Database Ready**: Drizzle ORM is configured with PostgreSQL dialect and migration support, indicating the application is designed to scale to persistent database storage when needed. The schema configuration points to Neon Database serverless PostgreSQL.

**Session Management**: Infrastructure exists for session-based authentication using `connect-pg-simple` for PostgreSQL session storage.

### AI Integration

**Provider**: Anthropic Claude API integrated through the official SDK.

**AI Configuration**: Uses Replit's AI Integrations service, with environment variables for API key and base URL configuration. This provides a managed, scalable AI backend.

**Prompt Engineering**: Custom prompts built for each bleaching level (Light, Moderate, Heavy, Very Heavy) with specific instructions for:
- Preserving exact syntax, punctuation, and structure
- Maintaining grammatical forms (plurals, tenses, gerunds)
- Consistent variable mapping (same word → same variable)
- Level-specific word replacement rules

**Processing Flow**: Client sends text and level → Server validates → Constructs level-specific prompt → Calls Anthropic API → Returns bleached text to client.

### Design Patterns

**Component Composition**: Extensive use of compound components and composition patterns (Radix UI primitives wrapped in custom styled components).

**Custom Hooks**: Centralized logic in custom hooks (`use-toast`, `use-mobile`) for reusability and separation of concerns.

**Type Safety**: End-to-end TypeScript with shared type definitions between client and server via the `@shared` alias, ensuring consistency across the stack.

**File Upload Handling**: React Dropzone integration for drag-and-drop file uploads with fallback to file picker.

**Utility Functions**: Centralized utility functions (`cn` for class name merging using `clsx` and `tailwind-merge`).

## External Dependencies

### Third-Party Services

- **Anthropic Claude API**: Core AI service for semantic bleaching functionality, accessed through Replit AI Integrations
- **Neon Database**: Serverless PostgreSQL database provider (configured but not actively used with in-memory storage)

### Key Libraries

**Frontend**:
- React 18 with React DOM
- TanStack Query for server state management
- Wouter for routing
- Radix UI component primitives (15+ components for dialogs, dropdowns, tooltips, etc.)
- Heroicons for iconography
- React Dropzone for file uploads
- React Hook Form with Zod resolvers for form validation
- Date-fns for date manipulation

**Backend**:
- Express.js web framework
- Anthropic SDK for AI integration
- Drizzle ORM with Neon serverless driver
- Zod for schema validation
- Connect-pg-simple for session storage

**Development Tools**:
- Vite for build tooling and dev server
- TypeScript for type safety
- Tailwind CSS for styling
- PostCSS with Autoprefixer
- ESBuild for production builds
- TSX for TypeScript execution in development

**UI & Styling**:
- shadcn/ui components
- Tailwind CSS with custom configuration
- Class Variance Authority for component variants
- Lucide React icons
- CMDK for command palette functionality