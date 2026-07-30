import 'reflect-metadata';

function makeClassDecorator(label: string): ClassDecorator {
  console.log(`eval class ${label}`);
  return (target) => {
    console.log(`apply class ${label} -> ${target.name}`);
  };
}

function makePropertyDecorator(label: string): PropertyDecorator {
  console.log(`eval property ${label}`);
  return (target, propertyKey) => {
    console.log(`apply property ${label} -> ${String(propertyKey)}`);
  };
}

function makeMethodDecorator(label: string): MethodDecorator {
  console.log(`eval method ${label}`);
  return (target, propertyKey) => {
    console.log(`apply method ${label} -> ${String(propertyKey)}`);
  };
}

function makeParameterDecorator(label: string): ParameterDecorator {
  console.log(`eval parameter ${label}`);
  return (target, propertyKey, parameterIndex) => {
    const member = propertyKey === undefined ? 'constructor' : String(propertyKey);
    console.log(`apply parameter ${label} -> ${member}[${parameterIndex}]`);
  };
}

class Dependency {}

interface ExternalPort {
  send(): void;
}

@makeClassDecorator('ClassA')
@makeClassDecorator('ClassB')
class DecoratorOrderSample {
  @makePropertyDecorator('PropA')
  field = 1;

  constructor(@makeParameterDecorator('CtorParamA') private readonly dep: Dependency) {}

  @makeMethodDecorator('MethodA')
  @makeMethodDecorator('MethodB')
  handle(
    @makeParameterDecorator('MethodParamA') first: string,
    @makeParameterDecorator('MethodParamB') second: number,
  ): void {
    void first;
    void second;
  }
}

function showParamTypes(label: string, target: Function): void {
  const params = Reflect.getMetadata('design:paramtypes', target) as Array<new (...args: never[]) => unknown> | undefined;
  if (!params) {
    console.log(`${label}: undefined`);
    return;
  }
  console.log(`${label}: [${params.map((p) => p.name).join(', ')}]`);
}

class RealDep {}

function Decorated(): ClassDecorator {
  return () => undefined;
}

@Decorated()
class InterfaceConsumer {
  constructor(private readonly port: ExternalPort) {}
}

@Decorated()
class ClassConsumer {
  constructor(private readonly dep: RealDep) {}
}

class UndecoratedConsumer {
  constructor(private readonly dep: RealDep) {}
}

void DecoratorOrderSample;

showParamTypes('decorated interface parameter', InterfaceConsumer);
showParamTypes('decorated class parameter', ClassConsumer);
showParamTypes('undecorated class parameter', UndecoratedConsumer);
