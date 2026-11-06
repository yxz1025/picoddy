import { c as createFlowDiagram, s as styles_default } from "./flowDiagram-HODETNUW-CRU7Ln3e.js";
import { _ as __name } from "./mermaid.core-BWDLE81Z.js";
import "./chunk-5VM5RSS4-DKIzoHaE.js";
import "./chunk-XXDRQBXY-D0E3sHrE.js";
import "./chunk-POPQ4Y6H-CI8F4x9m.js";
import "./chunk-F27PBJKO-Bm7HcyLY.js";
import "./channel-DP8EPyMv.js";
import "./index-jGEBGuXa.js";
var getStyles = /* @__PURE__ */ __name((options) => `${styles_default(options)}
  .swimlane.cluster rect {
    stroke: ${options.clusterBorder} !important;
  }
  [data-look="neo"].cluster rect {
    filter: none;
  }
`, "getStyles");
var styles_default2 = getStyles;
var diagram = createFlowDiagram({ defaultLayout: "swimlane", styles: styles_default2 });
export {
  diagram
};
