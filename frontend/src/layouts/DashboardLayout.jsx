import Sidebar from '../components/Sidebar.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';

export default function DashboardLayout({ activeSection }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Mobile Header */}
        <div className="md:hidden p-4 border-b border-border-subtle flex items-center justify-between bg-bg-app/95 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-brand-400 flex items-center justify-center shadow-lg shadow-brand-glow">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="text-xl font-display font-bold text-text-primary tracking-tight">
              SquadLogic
            </span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="text-text-secondary hover:text-text-primary p-2"
            aria-label="Hamburger Menu"
          >
            {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Theme Toggle Floating */}
        <div className="fixed bottom-6 right-6 z-50">
          <ThemeToggle />
        </div>

        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
