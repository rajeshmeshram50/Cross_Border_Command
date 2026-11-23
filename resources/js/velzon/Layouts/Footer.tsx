import React from 'react';
import { Col, Container, Row } from 'reactstrap';

/**
 * The app footer. Always on screen and always in the flow — it used to
 * auto-hide like a taskbar, sliding out while you read and back on scroll.
 * Kept static instead: DataTable reserves real space for it (bottomReserve),
 * so a footer that moves makes every fitted table on the page reason about a
 * moving target.
 */
const Footer = () => (
    <React.Fragment>
        <footer className="footer">
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

export default Footer;
