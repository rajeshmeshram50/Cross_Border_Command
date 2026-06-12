import React from 'react';

//constants
import { LAYOUT_MODE_TYPES } from "../../Components/constants/layout";

interface LightDarkProps {
    layoutMode : string;
    onChangeLayoutMode: (mode: string) => void;
}
const LightDark = ({ layoutMode, onChangeLayoutMode } : LightDarkProps) => {

    const isDark = layoutMode === LAYOUT_MODE_TYPES['DARKMODE'];
    const mode = isDark ? LAYOUT_MODE_TYPES['LIGHTMODE'] : LAYOUT_MODE_TYPES['DARKMODE'];

    return (
        <div className="ms-1 header-item d-flex">
            <button
                onClick={() => onChangeLayoutMode(mode)}
                type="button"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle light-dark-mode">
                {/* Icon reflects the CURRENT mode: sun while dark (offers light), moon while light (offers dark) */}
                <i className={`bx ${isDark ? 'bx-sun' : 'bx-moon'} fs-22`}></i>
            </button>
        </div>
    );
};

export default LightDark;