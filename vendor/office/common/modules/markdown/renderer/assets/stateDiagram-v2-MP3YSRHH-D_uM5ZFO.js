import { s as styles_default, b as stateRenderer_v3_unified_default, a as stateDiagram_default, S as StateDB } from "./chunk-IMKFNOWR-2Q2D4rck.js";
import { _ as __name } from "./mermaid.core-BWDLE81Z.js";
import "./chunk-XXDRQBXY-D0E3sHrE.js";
import "./chunk-POPQ4Y6H-CI8F4x9m.js";
import "./chunk-F27PBJKO-Bm7HcyLY.js";
import "./index-jGEBGuXa.js";
var diagram = {
  parser: stateDiagram_default,
  get db() {
    return new StateDB(2);
  },
  renderer: stateRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.state) {
      cnf.state = {};
    }
    cnf.state.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
