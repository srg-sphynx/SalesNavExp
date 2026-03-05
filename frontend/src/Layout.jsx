import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/Sidebar"

export default function Layout() {
    return (
        <div className="flex h-screen w-screen overflow-hidden bg-background font-sans antialiased text-foreground">
            {/* Sidebar */}
            <Sidebar />

            {/* Main content area */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                {/* Top drag bar — spans the entire width of the main area, above all content */}
                <div
                    className="h-10 w-full flex-shrink-0 select-none"
                    style={{ WebkitAppRegion: "drag" }}
                />
                {/* Scrollable page content */}
                <main className="flex-1 overflow-y-auto min-w-0">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
