﻿import { BaseJitsiClient } from "./jitsihax-client-base.js";

export class JitsiClient extends BaseJitsiClient {
    constructor() {
        super();
    }

    async getApiClassAsync() {
        await import(`https://${JITSI_HOST}/libs/external_api.min.js`);
        return JitsiMeetExternalAPI;
    }
}