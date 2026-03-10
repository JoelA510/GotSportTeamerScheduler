# SquadLogic

![SquadLogic Logo](logo.png)

> **Focus on the Field.**
>
> SquadLogic converts raw GotSport registration data into actionable teaming and scheduling frameworks, designed specifically to support youth sports organizations.

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/JoelA510/SquadLogic/actions)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4.21-646cff)](https://vitejs.dev/)

---

## 🚀 Overview

SquadLogic is a comprehensive tool for youth sports administrators. It simplifies the complex logistics of organizing leagues by automating team generation, practice scheduling, and game scheduling. Built with a modern tech stack and a "Deep Space Glass" design system, it offers a premium, intuitive user experience.

## ✨ Implemented vs. Planned Features

### ✅ Implemented Baseline

- **Core Domain & Utilities**: Shared packages for metrics, evaluation, normalization, and error handling.
- **Automated Team Generation**: Algorithmic allocation of players to teams honoring mutual buddy requests and coach assignments.
- **Practice & Game Scheduling Engines**: Conflict-aware round-robin generation and field/time slot allocation.
- **Evaluation Pipeline**: Automated readiness scoring, fairness metrics, and conflict detection.
- **Supabase Persistence**: Edge functions, RPCs, and transactional database schemas for saving schedules and overrides.
- **Admin Dashboard Shell**: React/Vite frontend with routing, multi-theme support (Dark/Light/Party), and data ingestion panels.

### 🚧 Partial / In-Progress

- **Role-Based Access Control (RBAC)**: `usePermission` hooks exist, but broader enforcement across all UI flows is ongoing.
- **Multi-Tenant Enforcement**: Organization context is wired, but strict RLS partitioning across all queries is being finalized.
- **Admin Workflows**: UI panels for manual overrides, drag-and-drop roster adjustments, and conflict resolution.

### 📅 Still Missing (Future)

- **Facility Management**: Full CRUD UI for venues, fields, and blackout dates.
- **Communication & Engagement**: RSVP tracking, trigger-based notifications (rainouts, schedule changes), and team chat.
- **Registration & Compliance**: Custom form builder, waiver tracking, and standings/results calculations.
- **Calendar Sync**: Public ICS feeds for parents and coaches.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite 5, React Router v7
- **Styling**: Vanilla CSS (Deep Space Glass Design System), Tailwind CSS
- **Backend**: Node.js, Supabase (PostgreSQL, Edge Functions, Storage, Auth)
- **Testing**: Vitest (Unit/Integration), Playwright (E2E - Planned)
- **Linting**: ESLint, Prettier

## 🗺️ Current Routes

The application is structured around the following core admin workflows (see `App.jsx`):

- `/` - **Dashboard**: High-level metrics, roadmap progress, and workflow orchestration.
- `/import` - **Data Import**: Ingestion of GotSport CSVs (Players, Coaches, Fields).
- `/teams` - **Team Management**: Roster generation, analysis, and manual overrides.
- `/fields` - **Field Management**: Configuration of venues, sub-units, and priorities.
- `/schedule/practice` - **Practice Schedule**: Field availability mapping and practice slot assignments.
- `/schedule/game` - **Game Schedule**: Round-robin matchups and Saturday game allocations.
- `/settings` - **Settings**: League configuration, theme branding, and season management.

## 🏁 Getting Started

### Prerequisites

- Node.js (v20 or higher)
- npm (v10 or higher)
- A Supabase Project (for database and auth)

### Installation

1. **Clone the repository:**

   ```bash
   git clone [https://github.com/JoelA510/SquadLogic.git](https://github.com/JoelA510/SquadLogic.git)
   cd SquadLogic
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Environment Setup:**
   Copy `.env.example` to `.env.local` and populate your Supabase credentials.

4. **Start the development server:**
   ```bash
   npm run frontend:dev
   ```
   The application will be available at `http://localhost:5173`.

### Building for Production

To create a production build:

```bash
npm run frontend:build
```

## 📄 Documentation

Detailed architecture, roadmap, and testing plans can be found in the `docs/` directory.

- [Expansion Roadmap](docs/expansion/03_ROADMAP.md)
- [E2E Testing Master Plan](docs/testing/e2e_master_plan.md)

## 📄 License

This project is licensed under the [ISC License](https://opensource.org/licenses/ISC).
