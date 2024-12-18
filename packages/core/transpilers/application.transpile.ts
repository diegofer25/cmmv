import * as fs from 'fs';
import * as path from 'path';

import { Config, ITranspile, Logger, Scope } from '../lib';

export class ApplicationTranspile implements ITranspile {
    private logger: Logger = new Logger('ExpressTranspile');

    run(): void {
        const contracts = Scope.getArray<any>('__contracts');
        contracts?.forEach((contract: any) => this.generateModel(contract));
    }

    private generateModel(contract: any): void {
        const outputPath = path.resolve(contract.protoPath);
        const outputDir = path.dirname(outputPath);
        const modelName = `${contract.controllerName}`;
        const modelInterfaceName = `I${modelName}`;
        const modelFileName = `${modelName.toLowerCase()}.model.ts`;
        let includeId = '';

        if (
            modelInterfaceName !== 'IWsCall' &&
            modelInterfaceName !== 'IWsError'
        )
            includeId = `${Config.get('repository.type') === 'mongodb' ? '    _id?: ObjectId' : '    id?: any'};\n`;

        const modelTemplate = `// Generated automatically by CMMV

${this.generateClassImports(contract)}
        
export interface ${modelInterfaceName} {
${includeId}${contract.fields?.map((field: any) => `    ${field.propertyKey}: ${this.mapToTsType(field.protoType)};`).join('\n')}
}

export class ${modelName} implements ${modelInterfaceName} {
${includeId ? '    @Expose()\n' + includeId + '\n' : ''}${contract.fields?.map((field: any) => this.generateClassField(field)).join('\n\n')}

    constructor(partial: Partial<${modelName}>) {
        Object.assign(this, partial);
    }

    public serialize(){
        return instanceToPlain(this);
    }

    public toString(){
        return ${modelName}FastSchema(this);
    }
}

// Schema for fast-json-stringify
export const ${modelName}FastSchema = fastJson({
    title: '${modelName} Schema',
    type: 'object',
    properties: {
${contract.fields?.map((field: any) => `        ${field.propertyKey}: ${this.generateJsonSchemaField(field)}`).join(',\n')}
    },
    required: [${contract.fields
        .filter((field: any) => field.required)
        .map((field: any) => `"${field.propertyKey}"`)
        .join(', ')}]
});
`;

        const dirname = path.resolve(outputDir, '../models');

        if (!fs.existsSync(dirname)) fs.mkdirSync(dirname, { recursive: true });

        const outputFilePath = path.join(outputDir, '../models', modelFileName);
        fs.writeFileSync(outputFilePath, modelTemplate, 'utf8');
    }

    private generateClassImports(contract: any): string {
        const importStatements: string[] = [
            `import * as fastJson from 'fast-json-stringify';`,
        ];

        if (Config.get('repository.type') === 'mongodb') {
            importStatements.push(`import { ObjectId } from 'mongodb';`);
        }

        const hasExclude = contract.fields?.some(
            (field: any) => field.exclude || field.toClassOnly,
        );

        const hasTransform = contract.fields?.some(
            (field: any) => field.transform,
        );

        const hasType = contract.fields?.some(
            (field: any) => field.protoType === 'date',
        );

        const imports = ['Expose', 'instanceToPlain'];

        if (hasExclude || hasTransform || hasType) {
            if (hasExclude) imports.push('Exclude');
            if (hasTransform) imports.push('Transform');
            if (hasType) imports.push('Type');
        }

        importStatements.push(
            `import { ${imports.join(', ')} } from 'class-transformer';`,
        );

        const validationImports = new Set<string>();
        contract.fields?.forEach((field: any) => {
            if (field.validations) {
                field.validations?.forEach((validation: any) => {
                    const validationName = Array.isArray(validation.type)
                        ? validation.type[0]
                        : validation.type;
                    validationImports.add(validationName);
                });
            }
        });

        if (validationImports.size > 0) {
            importStatements.push(
                `import { ${Array.from(validationImports).join(', ')} } from 'class-validator';`,
            );
        }

        if (contract.imports && contract.imports.length > 0) {
            for (const module of contract.imports)
                importStatements.push(
                    `import * as ${module} from '${module}';`,
                );
        }

        return importStatements.length > 0 ? importStatements.join('\n') : '';
    }

    private generateClassField(field: any): string {
        const decorators: string[] = [];

        if (field.exclude && field.toClassOnly) {
            decorators.push(
                `    @Exclude(${field.toClassOnly ? `{ toClassOnly: true }` : ''})`,
            );
        } else {
            decorators.push(`    @Expose()`);
        }

        if (field.transform) {
            const cleanedTransform = field.transform
                .toString()
                .replace(/_([a-zA-Z]+)/g, ' $1');

            decorators.push(
                `    @Transform(${cleanedTransform}${field.toClassOnly ? `, { toClassOnly: true }` : ''})`,
            );
        }

        if (field.protoType === 'date') {
            decorators.push(`    @Type(() => Date)`);
        }

        if (field.validations) {
            field.validations?.forEach((validation: any) => {
                const validationName = Array.isArray(validation.type)
                    ? validation.type[0]
                    : validation.type;
                const validationParams = Array.isArray(validation.type)
                    ? validation.type
                          .slice(1)
                          .map(param => JSON.stringify(param))
                          .join(', ')
                    : validation.value !== undefined
                      ? validation.value
                      : '';

                const options = [];
                if (validation.message) {
                    options.push(`message: "${validation.message}"`);
                }
                if (validation.context) {
                    const contextString = JSON.stringify(
                        validation.context,
                    ).replace(/"([^"]+)":/g, '$1:');
                    options.push(`context: ${contextString}`);
                }
                let optionsString =
                    options.length > 0 ? `{ ${options.join(', ')} }` : '';

                if (validationParams && optionsString)
                    optionsString = ', ' + optionsString;

                decorators.push(
                    `    @${validationName}(${validationParams}${
                        optionsString ? optionsString : ''
                    })`,
                );
            });
        }

        let defaultValueString = '';
        if (field.defaultValue !== undefined) {
            const defaultValue =
                typeof field.defaultValue === 'string'
                    ? `"${field.defaultValue}"`
                    : field.defaultValue;
            defaultValueString = ` = ${defaultValue};`;
        }

        return `${decorators.length > 0 ? decorators.join('\n') + '\n' : ''}    ${field.propertyKey}: ${this.mapToTsType(field.protoType)}${defaultValueString}`;
    }

    private mapToTsType(protoType: string): string {
        const typeMapping: { [key: string]: string } = {
            string: 'string',
            boolean: 'boolean',
            bool: 'boolean',
            int: 'number',
            int32: 'number',
            int64: 'number',
            float: 'number',
            double: 'number',
            bytes: 'Uint8Array',
            date: 'string',
            timestamp: 'string',
            text: 'string',
            json: 'any',
            jsonb: 'any',
            uuid: 'string',
            time: 'string',
            simpleArray: 'string[]',
            simpleJson: 'any',
            bigint: 'bigint',
            uint32: 'number',
            uint64: 'number',
            sint32: 'number',
            sint64: 'number',
            fixed32: 'number',
            fixed64: 'number',
            sfixed32: 'number',
            sfixed64: 'number',
            any: 'any',
        };

        return typeMapping[protoType] || 'any';
    }

    private generateJsonSchemaField(field: any): string {
        const parts = [`type: "${this.mapToJsonSchemaType(field.protoType)}"`];

        if (field.defaultValue !== undefined) {
            parts.push(`default: ${JSON.stringify(field.defaultValue)}`);
        }

        if (field.description) {
            parts.push(`description: "${field.description}"`);
        }

        return `{ ${parts.join(', ')} }`;
    }

    private mapToJsonSchemaType(protoType: string): string {
        const typeMapping: { [key: string]: string } = {
            string: 'string',
            boolean: 'boolean',
            bool: 'boolean',
            int: 'integer',
            int32: 'integer',
            int64: 'integer',
            float: 'number',
            double: 'number',
            bytes: 'string',
            date: 'string',
            timestamp: 'string',
            text: 'string',
            json: 'object',
            jsonb: 'object',
            uuid: 'string',
            time: 'string',
            simpleArray: 'array',
            simpleJson: 'object',
            bigint: 'integer',
            uint32: 'integer',
            uint64: 'integer',
            sint32: 'integer',
            sint64: 'integer',
            fixed32: 'integer',
            fixed64: 'integer',
            sfixed32: 'integer',
            sfixed64: 'integer',
            any: 'any',
        };

        return typeMapping[protoType] || 'any';
    }
}
