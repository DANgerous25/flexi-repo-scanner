import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Tasks from "@/pages/Tasks";
import TaskEditor from "@/pages/TaskEditor";
import TaskResults from "@/pages/TaskResults";
import Connections from "@/pages/Connections";
import Benchmarks from "@/pages/Benchmarks";
import Settings from "@/pages/Settings";
import Notifications from "@/pages/Notifications";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/tasks/new" component={TaskEditor} />
        <Route path="/tasks/:id/edit" component={TaskEditor} />
        <Route path="/tasks/:id/results" component={TaskResults} />
        <Route path="/connections" component={Connections} />
        <Route path="/benchmarks" component={Benchmarks} />
        <Route path="/settings" component={Settings} />
        <Route path="/notifications" component={Notifications} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
