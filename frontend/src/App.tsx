import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { RequireAuth } from "@/components/RequireAuth";
import { BrowseView } from "@/routes/BrowseView";
import { CompareView } from "@/routes/CompareView";
import { LoginPage } from "@/routes/LoginPage";
import { ReaderView } from "@/routes/ReaderView";
import { SearchView } from "@/routes/SearchView";
import { StatusView } from "@/routes/StatusView";

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
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
        <ReaderView />
      </RequireAuth>
    ),
  },
]);

export function App(): JSX.Element {
  return <RouterProvider router={router} />;
}
