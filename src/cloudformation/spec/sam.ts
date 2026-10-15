/** Pinned offline AWS SAM resource descriptors used by the property editor. */
import type { CloudFormationResourceSpecification, ResourcePropertySpecification } from '../resourceSpec';

const json = (required = false): ResourcePropertySpecification => ({ PrimitiveType: 'Json', Required: required });
const string = (required = false): ResourcePropertySpecification => ({ PrimitiveType: 'String', Required: required });

export const SAM_RESOURCE_SPECIFICATION: CloudFormationResourceSpecification = {
  ResourceSpecificationVersion: 'SAM-2016-10-31@2026-10-15',
  PropertyTypes: {},
  ResourceTypes: {
    'AWS::Serverless::Function': { Properties: { Handler: string(), Runtime: string(), CodeUri: json(), InlineCode: string(), ImageUri: string(), PackageType: string(), Role: string(), Policies: json(), Events: json(), Environment: json(), VpcConfig: json(), Layers: json(), Architectures: json(), Timeout: json(), MemorySize: json(), ReservedConcurrentExecutions: json(), AutoPublishAlias: string(), DeploymentPreference: json(), FunctionUrlConfig: json(), FileSystemConfigs: json(), Tags: json(), Tracing: string(), Metadata: json() } },
    'AWS::Serverless::Api': { Properties: { StageName: string(), DefinitionBody: json(), DefinitionUri: json(), Auth: json(), Cors: json(), Domain: json(), EndpointConfiguration: json(), GatewayResponses: json(), Models: json(), OpenApiVersion: string(), TracingEnabled: json(), Variables: json(), Tags: json() } },
    'AWS::Serverless::HttpApi': { Properties: { StageName: string(), DefinitionBody: json(), DefinitionUri: json(), Auth: json(), CorsConfiguration: json(), Domain: json(), StageVariables: json(), Tags: json(), FailOnWarnings: json(), RouteSettings: json(), DefaultRouteSettings: json(), AccessLogSettings: json() } },
    'AWS::Serverless::SimpleTable': { Properties: { PrimaryKey: json(), ProvisionedThroughput: json(), SSESpecification: json(), TableName: string(), Tags: json() } },
    'AWS::Serverless::StateMachine': { Properties: { Definition: json(), DefinitionUri: json(), DefinitionSubstitutions: json(), Role: string(), Policies: json(), Events: json(), Logging: json(), Tracing: json(), Type: string(), Name: string(), PermissionsBoundary: string(), Tags: json() } },
    'AWS::Serverless::LayerVersion': { Properties: { ContentUri: json(), CompatibleArchitectures: json(), CompatibleRuntimes: json(), Description: string(), LayerName: string(), LicenseInfo: string(), RetentionPolicy: string() } },
    'AWS::Serverless::Application': { Properties: { Location: json(true), Parameters: json(), NotificationArns: json(), Tags: json(), TimeoutInMinutes: json() } },
    'AWS::Serverless::Connector': { Properties: { Source: json(true), Destination: json(true), Permissions: json(true) } },
    'AWS::Serverless::GraphQLApi': { Properties: { SchemaInline: string(), SchemaUri: json(), Auth: json(), ApiKeys: json(), DataSources: json(), Functions: json(), Resolvers: json(), Domain: json(), Logging: json(), Name: string(), Tags: json(), XrayEnabled: json() } },
  },
};
