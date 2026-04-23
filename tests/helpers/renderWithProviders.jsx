import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { AuthProvider } from '../../frontend/src/contexts/AuthContext.jsx';
import { OrganizationProvider } from '../../frontend/src/contexts/OrganizationContext.jsx';
import { ImportProvider } from '../../frontend/src/contexts/ImportContext.jsx';
import { ThemeProvider } from '../../frontend/src/contexts/ThemeContext.jsx';
import { makeOrganization, makeUser } from '../factories/index.js';

/**
 * RTL `render()` wrapped with SquadLogic's canonical provider chain.
 *
 * Provider order mirrors `frontend/src/App.jsx` exactly:
 *   BrowserRouter → AuthProvider → OrganizationProvider → ImportProvider → ThemeProvider
 *
 * Differences from App.jsx (intentional):
 * - `<BrowserRouter>` becomes `<MemoryRouter>` to avoid jsdom URL issues.
 * - `<ErrorBoundary>` and `<OfflineGuard>` are omitted. Tests that need to
 *   assert error-boundary or offline behavior wrap manually.
 *
 * @param {React.ReactElement} ui
 * @param {{
 *   user?: any,
 *   organization?: any,
 *   route?: string,
 * } & import('@testing-library/react').RenderOptions} [options]
 */
export function renderWithProviders(ui, options = {}) {
  const {
    user = makeUser(),
    organization = makeOrganization(),
    route = '/',
    ...rtlOptions
  } = options;

  sessionStorage.setItem('squadlogic_mock_user', JSON.stringify(user));
  if (organization?.id) localStorage.setItem('squadlogic_active_org', organization.id);

  function Wrapper({ children }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <OrganizationProvider>
            <ImportProvider>
              <ThemeProvider>{children}</ThemeProvider>
            </ImportProvider>
          </OrganizationProvider>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...rtlOptions });
}
