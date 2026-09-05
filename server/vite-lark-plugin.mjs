import { handleLarkApi } from "./lark-api.mjs";

export function larkApiPlugin() {
  return {
    name: "zdocs-lark-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        Promise.resolve(handleLarkApi(request, response)).then((handled) => { if (!handled) next(); }).catch(next);
      });
    },
  };
}
