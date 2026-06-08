import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { RequireAuth } from "@/components/RequireAuth";
import { useApplyTheme } from "@/hooks/useTheme";
import { BrowseView } from "@/routes/BrowseView";
import { CompareView } from "@/routes/CompareView";
import { LoginPage } from "@/routes/LoginPage";
import { PlaceDetailView } from "@/routes/PlaceDetailView";
import { PlacesView } from "@/routes/PlacesView";
import { ReaderView } from "@/routes/ReaderView";
import { SearchView } from "@/routes/SearchView";
import { StatusView } from "@/routes/StatusView";
import { WelcomeView } from "@/routes/WelcomeView";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <WelcomeView />
      </RequireAuth>
    ),
  },
  {
    path: "/read",
    element: (
      <RequireAuth>
        <ReaderView />
      </RequireAuth>
    ),
  },
  {
    path: "/browse",
    element: (
      <RequireAuth>
        <BrowseView />
      </RequireAuth>
    ),
  },
  {
    path: "/compare",
    element: (
      <RequireAuth>
        <CompareView />
      </RequireAuth>
    ),
  },
  {
    path: "/search",
    element: (
      <RequireAuth>
        <SearchView />
      </RequireAuth>
    ),
  },
  {
    path: "/places",
    element: (
      <RequireAuth>
        <PlacesView />
      </RequireAuth>
    ),
  },
  {
    path: "/places/:id",
    element: (
      <RequireAuth>
        <PlaceDetailView />
      </RequireAuth>
    ),
  },
  {
    path: "/status",
    element: (
      <RequireAuth>
        <StatusView />
      </RequireAuth>
    ),
  },
  {
    path: "*",
    element: (
      <RequireAuth>
        <WelcomeView />
      </RequireAuth>
    ),
  },
]);

export function App(): JSX.Element {
  // Keep the colour scheme in sync with the profile (default: follow the OS) — app-wide (#60).
  useApplyTheme();
  return <RouterProvider router={router} />;
}
