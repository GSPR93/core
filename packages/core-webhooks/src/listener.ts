import { Container, Contracts, Enums, Providers, Utils } from "@arkecosystem/core-kernel";

import * as conditions from "./conditions";
import { Database } from "./database";
import { Webhook } from "./interfaces";

// todo: inject database via container instead of passing references around between methods
// todo: review the implementation and potentially turn this into a class with smaller and easily testable methods
export const startListeners = (app: Contracts.Kernel.Application): void => {
    for (const event of Object.values(Enums.Events.State)) {
        app.events.listen(event, async payload => {
            const webhooks: Webhook[] = app
                .get<Database>("webhooks.db")
                .findByEvent(event)
                .filter((webhook: Webhook) => {
                    if (!webhook.enabled) {
                        return false;
                    }

                    if (!webhook.conditions || (Array.isArray(webhook.conditions) && !webhook.conditions.length)) {
                        return true;
                    }

                    for (const condition of webhook.conditions) {
                        try {
                            const satisfies = conditions[condition.condition];

                            if (satisfies(payload[condition.key], condition.value)) {
                                return true;
                            }
                        } catch (error) {
                            return false;
                        }
                    }

                    return false;
                });

            for (const webhook of webhooks) {
                try {
                    const { statusCode } = await Utils.http.post(webhook.target, {
                        body: {
                            timestamp: +new Date(),
                            data: payload as any,
                            event: webhook.event,
                        },
                        headers: {
                            Authorization: webhook.token,
                        },
                        timeout: app
                            .get<Providers.ServiceProviderRepository>(Container.Identifiers.ServiceProviderRepository)
                            .get("@arkecosystem/core-webhooks")
                            .config()
                            .get("timeout"),
                    });

                    app.log.debug(
                        `Webhooks Job ${webhook.id} completed! Event [${webhook.event}] has been transmitted to [${webhook.target}] with a status of [${statusCode}].`,
                    );
                } catch (error) {
                    app.log.error(`Webhooks Job ${webhook.id} failed: ${error.message}`);
                }
            }
        });
    }
};
