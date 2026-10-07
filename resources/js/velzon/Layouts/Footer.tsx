import React, { useEffect, useRef, useState } from 'react';
import { Col, Container, Row } from 'reactstrap';

/** How long after the last scroll the bar slides away again. */
const IDLE_MS = 1600;
/** How close to the bottom edge the pointer has to come to call it back. */
const EDGE_PX = 28;

/**
 * Auto-hiding footer, in the manner of a taskbar set to auto-hide: out of sight
 * while you are reading, back as soon as you move.
 *
 * It reveals on SCROLL — from any scroller, not just the window. Most pages in
 * this app never scroll the window at all: `.main-content` is viewport-tall and
 * the list scrolls inside its own box, so a `window.onscroll` listener would sit
 * there and never fire. `scroll` does not bubble, so the listener is attached in
 * the CAPTURE phase, where it still sees events from nested scrollers.
 *
 * It only MOVES — it is never removed from the flow, and its 40px slot stays
 * reserved whether it is shown or not. That is deliberate: DataTable sizes every
 * fitted table from this element's offsetHeight (see `bottomReserve`), so a
 * footer that truly collapsed would make every table on the page grow, then jump
 * back the moment it returned — or, if it came back on top, bury the pager it
 * would be covering. Sliding keeps the geometry still.
 */
const Footer = () => {
    const [visible, setVisible] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const show = () => {
            setVisible(true);
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setVisible(false), IDLE_MS);
        };

        const onPointerMove = (e: MouseEvent) => {
            // Near the bottom edge: bring it back and keep it while you are there,
            // the way a hidden taskbar answers the pointer.
            if (window.innerHeight - e.clientY <= EDGE_PX) show();
        };

        // Capture, so scrolling INSIDE a table or panel counts too.
        document.addEventListener('scroll', show, true);
        window.addEventListener('wheel', show, { passive: true });
        document.addEventListener('mousemove', onPointerMove, { passive: true });

        return () => {
            document.removeEventListener('scroll', show, true);
            window.removeEventListener('wheel', show);
            document.removeEventListener('mousemove', onPointerMove);
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, []);

    return (
        <React.Fragment>
            <footer className={`footer app-footer-auto${visible ? ' is-visible' : ''}`}>
                <Container fluid>
                    <Row>
                        <Col sm={6}>
                            {new Date().getFullYear()} © IGC Group.
                        </Col>
                        <Col sm={6}>
                            <div className="text-sm-end d-none d-sm-block">
                                Design &amp; Develop by IGC
                            </div>
                        </Col>
                    </Row>
                </Container>
            </footer>
        </React.Fragment>
    );
};

export default Footer;
