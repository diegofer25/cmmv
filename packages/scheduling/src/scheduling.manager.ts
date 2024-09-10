import { CronJob, CronTime } from 'cron';
import { Logger } from '@cmmv/core';

type CronObserver = () => void;

export class SchedulingManager {
    private cronJob: CronJob;
    private observers: CronObserver[] = [];
    private logger: Logger = new Logger('SchedulingManager');

    constructor(cronTime: string, onTick: () => void) {
        this.cronJob = new CronJob(cronTime, () =>
            this.notifyObservers(onTick),
        );
        this.logger.log(`Initialized cron job with schedule: ${cronTime}`);
    }

    public start(): void {
        if (!this.cronJob.running) {
            this.cronJob.start();
            this.logger.log(`Cron job started`);
        }
    }

    public stop(): void {
        if (this.cronJob.running) {
            this.cronJob.stop();
            this.logger.log(`Cron job stopped`);
        }
    }

    public restart(): void {
        this.stop();
        this.start();
        this.logger.log(`Cron job restarted`);
    }

    public changeCronTime(newCronTime: string): void {
        this.cronJob.setTime(new CronTime(newCronTime));
        this.restart();
        this.logger.log(`Cron job time changed to: ${newCronTime}`);
    }

    public addObserver(observer: CronObserver): void {
        this.observers.push(observer);
        this.logger.log(`Observer added to cron job`);
    }

    private notifyObservers(originalOnTick: () => void): void {
        originalOnTick();
        this.observers.forEach(observer => observer());
        this.logger.log('Notified all observers after cron execution');
    }
}
