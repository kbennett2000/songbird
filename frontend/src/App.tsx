import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { StatusView } from "@/routes/StatusView";

const router = createBrowserRouter([
  { path: "/", element: <StatusView /> },
  { path: "*", element: <StatusView /> },
]);

export function App(): JSX.Element {
  return <RouterProvider router={router} />;
}
