import { combineReducers } from "redux";

// Only the Layout slice — other Velzon slices (Calendar, Chat, Crypto,
// Ecommerce, etc) are not used by Cross_Border_Command.
import LayoutReducer from "./layouts/reducer";

const rootReducer = combineReducers({
  Layout: LayoutReducer,
});

export default rootReducer;
