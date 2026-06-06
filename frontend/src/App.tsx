import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { BrowseView } from "@/routes/BrowseView";
import { ReaderView } from "@/routes/ReaderView";
import { StatusView } from "@/routes/StatusView";

const router = createBrowserRouter([
  { path: "/", element: <ReaderView /> },
  { path: "/browse", element: <BrowseView /> },
  { path: "/status", element: <StatusView /> },
  { path: "*", element: <ReaderView /> },
]);

export function App(): JSX.Element {
  return <RouterProvider router={router} />;
}
