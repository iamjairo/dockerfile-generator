import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Lightweight health check endpoint for ALB readiness probes.
 * Returns 200 with empty body at /__health — avoids loading the full app
 * just to check if the dev server is reachable.
 */
function healthCheckPlugin() {
    return {
        name: 'codepal-health-check',
        configureServer(server) {
            server.middlewares.use('/__health', (_req, res) => {
                res.statusCode = 200;
                res.end();
            });
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    cacheDir: '/tmp/.vite',
    server: {
        host: "::",
        port: 8080,
        // Allow preview URLs via CodePal environments
        allowedHosts: [".localhost", ".codepal.ai", ".codepal.site"],
        hmr: {
            overlay: false,
        },
        fs: {
            // Allow serving pre-bundled deps from cacheDir (/tmp/.vite)
            // Without this, @fs/tmp/.vite/deps/* requests get 403 Forbidden
            allow: ['.', '/tmp/.vite'],
        },
    },
    plugins: [healthCheckPlugin(), react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
}));
