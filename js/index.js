﻿import { JitsiClient } from "./html/jitsihax-client-external-api.js";
import { init } from "./html/app.js";
import {
    A,
    H2,
    P,
    Span
} from "./html/htmltags.js";

import {
    ariaLabel,
    className,
    href,
    target,
    title,
    rel,
    role
} from "./html/htmlattrs.js";

const { toolbar, loginForm } = init(JitsiClient, document.querySelector("#appView"));


function adLink(url, label, icon) {
    return A(
        href(url),
        target("_blank"),
        rel("noopener"),
        ariaLabel(label.replace("GitHub", "Git Hub")),
        title(label),
        Span(className(`icon icon-${icon}`),
            role("presentation")));
}

toolbar.append(
    adLink(
        "https://github.com/capnmidnight/Calla",
        "Follow Calla on GitHub",
        "github"),
    adLink(
        "https://twitter.com/Sean_McBeth",
        "Follow Sean on Twitter",
        "twitter"));

loginForm.append(
    H2("Made by"),
    P(adLink(
        "https://www.seanmcbeth.com",
        "Sean T. McBeth",
        "shrink"),
        "Sean T. McBeth"),
    P(adLink("https://twitter.com/Sean_McBeth",
        "Follow Sean on Twitter",
        "twitter"),
        "Follow @Sean_McBeth on Twitter"));