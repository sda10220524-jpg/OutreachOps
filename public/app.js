import { OO } from "./firebase.js";
import { createEngine } from "./store.js";
import { initUI, setData } from "./ui.js";

const root = document.getElementById("app");
const engine = createEngine(OO);

initUI(root, engine);
setData(engine.getSnapshot());
engine.setRealtime((snapshot) => {
  setData(snapshot);
});
