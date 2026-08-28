import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/watchlist" component={Home} />
    <Route path="/agents" component={Home} />
    <Route path="/signals" component={Home} />
    <Route path="/sandbox" component={Home} />
    <Route path="/risk" component={Home} />
    <Route path="/audit" component={Home} />
    <Route path="/settings" component={Home} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary>
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider>
        <Toaster />
        <DashboardLayout><Router /></DashboardLayout>
      </TooltipProvider>
    </ThemeProvider>
  </ErrorBoundary>;
}

export default App;
