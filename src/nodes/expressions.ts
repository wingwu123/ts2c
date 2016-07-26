import * as ts from 'typescript';
import {CodeTemplate, CodeTemplateFactory} from '../template';
import {IScope} from '../program';
import {CType, ArrayType, StructType, StringVarType, NumberVarType, BooleanVarType, UniversalVarType, PointerVarType} from '../types';
import {AssignmentHelper, CAssignment} from './assignment';
import {PrintfHelper} from './printf';
import {CVariable} from './variable';

export interface CExpression { }

@CodeTemplate(`
{#statements}
    {#if !topExpressionOfStatement && propName == "push" && arguments.length == 1}
        ARRAY_PUSH({arrayAccess}, {arguments});
    {/if}
{/statements}
{#if topExpressionOfStatement && propName == "push" && arguments.length == 1}
    ARRAY_PUSH({arrayAccess}, {arguments})
{#elseif propName == "push" && arguments.length == 1}
    {arrayAccess}->size
{#elseif propName == "pop" && arguments.length == 0}
    ARRAY_POP({arrayAccess})
{#elseif printfCalls.length}
    {printfCalls}
{#else}
    {funcName}({arguments {, }=> {this}})
{/if}`, ts.SyntaxKind.CallExpression)
export class CCallExpression {
    public funcName: string;
    public propName: string = null;
    public topExpressionOfStatement: boolean;
    public arrayAccess: CElementAccess;
    public arguments: CExpression[];
    public printfCalls: any[] = [];
    constructor(scope: IScope, call: ts.CallExpression) {
        this.funcName = call.expression.getText();
        this.topExpressionOfStatement =  call.parent.kind == ts.SyntaxKind.ExpressionStatement;
        if (this.funcName != "console.log")
            this.arguments = call.arguments.map(a => CodeTemplateFactory.createForNode(scope, a));

        if (call.expression.kind == ts.SyntaxKind.PropertyAccessExpression) {
            let propAccess = <ts.PropertyAccessExpression>call.expression;
            this.propName = propAccess.name.getText();
            this.arrayAccess = new CElementAccess(scope, propAccess.expression);
            
            if (this.funcName == "console.log") {
                this.printfCalls = call.arguments.map(a => PrintfHelper.create(scope, a));
                scope.root.headerFlags.printf = true;
            }
            if (propAccess.name.getText() == 'push' && this.arguments.length == 1) {
                scope.root.headerFlags.array = true;
            }
            if (propAccess.name.getText() == 'pop' && this.arguments.length == 0) {
                scope.root.headerFlags.array = true;
                scope.root.headerFlags.array_pop = true;
            }
        }
    }
}

@CodeTemplate(`
{#statements}
    {#if replacedWithVar && strPlusStr}
        {replacementVarName} = malloc(strlen({left}) + strlen({right}) + 1);
        assert({replacementVarName} != NULL);
        strcpy({replacementVarName}, {left});
        strcat({replacementVarName}, {right});
    {#elseif replacedWithVar && strPlusNumber}
        {replacementVarName} = malloc(strlen({left}) + STR_INT16_T_BUFLEN + 1);
        assert({replacementVarName} != NULL);
        {replacementVarName}[0] = '\\0';
        strcat({replacementVarName}, {left});
        str_int16_t_cat({replacementVarName}, {right});
    {#elseif replacedWithVar && numberPlusStr}
        {replacementVarName} = malloc(strlen({right}) + STR_INT16_T_BUFLEN + 1);
        assert({replacementVarName} != NULL);
        {replacementVarName}[0] = '\\0';
        str_int16_t_cat({replacementVarName}, {left});
        strcat({replacementVarName}, {right});
    {/if}
{/statements}
{#if operator}
    {left} {operator} {right}
{#elseif replacedWithCall}
    {call}({left}, {right}){callCondition}
{#elseif replacedWithVar}
    {replacementVarName}
{#else}
    /* unsupported expression {nodeText} */
{/if}`, ts.SyntaxKind.BinaryExpression)
class CBinaryExpression {
    public nodeText: string;
    public operator: string;
    public replacedWithCall: boolean = false;
    public call: string;
    public callCondition: string;
    public replacedWithVar: boolean = false;
    public replacementVarName: string;
    public strPlusStr:boolean = false;
    public strPlusNumber:boolean = false;
    public numberPlusStr:boolean = false;
    public left: CExpression;
    public right: CExpression;
    constructor(scope: IScope, node: ts.BinaryExpression) {
        let operatorMap: { [token: number]: string } = {};
        let callReplaceMap: { [token: number]: [string, string] } = {};
        let leftType = scope.root.typeHelper.getCType(node.left);
        let rightType = scope.root.typeHelper.getCType(node.right);
        this.left = CodeTemplateFactory.createForNode(scope, node.left);
        this.right = CodeTemplateFactory.createForNode(scope, node.right);
        if (leftType == NumberVarType && rightType == NumberVarType) {
            operatorMap[ts.SyntaxKind.GreaterThanToken] = '>';
            operatorMap[ts.SyntaxKind.GreaterThanEqualsToken] = '>=';
            operatorMap[ts.SyntaxKind.LessThanToken] = '<';
            operatorMap[ts.SyntaxKind.LessThanEqualsToken] = '<=';
            operatorMap[ts.SyntaxKind.ExclamationEqualsEqualsToken] = '!=';
            operatorMap[ts.SyntaxKind.ExclamationEqualsToken] = '!=';
            operatorMap[ts.SyntaxKind.EqualsEqualsEqualsToken] = '==';
            operatorMap[ts.SyntaxKind.EqualsEqualsToken] = '==';
            operatorMap[ts.SyntaxKind.AsteriskToken] = '*';
            operatorMap[ts.SyntaxKind.SlashToken] = '/';
            operatorMap[ts.SyntaxKind.PlusToken] = '+';
            operatorMap[ts.SyntaxKind.MinusToken] = '-';
        }
        else if (leftType == StringVarType && rightType == StringVarType) {
            callReplaceMap[ts.SyntaxKind.ExclamationEqualsEqualsToken] = ['strcmp', ' != 0'];
            callReplaceMap[ts.SyntaxKind.ExclamationEqualsToken] = ['strcmp', ' != 0'];
            callReplaceMap[ts.SyntaxKind.EqualsEqualsEqualsToken] = ['strcmp', ' == 0'];
            callReplaceMap[ts.SyntaxKind.EqualsEqualsToken] = ['strcmp', ' == 0'];

            if (callReplaceMap[node.operatorToken.kind])
                scope.root.headerFlags.strings = true;

            if (node.operatorToken.kind == ts.SyntaxKind.PlusToken) {
                let tempVarName = scope.root.typeHelper.addNewTemporaryVariable(node, "tmp_string");
                scope.variables.push(new CVariable(scope, tempVarName, "char *"));
                this.replacedWithVar = true;
                this.replacementVarName = tempVarName;
                this.strPlusStr = true;
                scope.root.headerFlags.strings = true;
                scope.root.headerFlags.malloc = true;
            }
        }
        else if (leftType == NumberVarType && rightType == StringVarType
            || leftType == StringVarType && rightType == NumberVarType) {

            callReplaceMap[ts.SyntaxKind.ExclamationEqualsEqualsToken] = ['str_int16_t_cmp', ' != 0'];
            callReplaceMap[ts.SyntaxKind.ExclamationEqualsToken] = ['str_int16_t_cmp', ' != 0'];
            callReplaceMap[ts.SyntaxKind.EqualsEqualsEqualsToken] = ['str_int16_t_cmp', ' == 0'];
            callReplaceMap[ts.SyntaxKind.EqualsEqualsToken] = ['str_int16_t_cmp', ' == 0'];

            if (callReplaceMap[node.operatorToken.kind]) {
                scope.root.headerFlags.str_int16_t_cmp = true;
                // str_int16_t_cmp expects certain order of arguments (string, number)
                if (leftType == NumberVarType) {
                    let tmp = this.left;
                    this.left = this.right;
                    this.right = tmp;
                }
            }

            if (node.operatorToken.kind == ts.SyntaxKind.PlusToken) {
                let tempVarName = scope.root.typeHelper.addNewTemporaryVariable(node, "tmp_string");
                scope.variables.push(new CVariable(scope, tempVarName, "char *"));
                this.replacedWithVar = true;
                this.replacementVarName = tempVarName;
                if (leftType == NumberVarType)
                    this.numberPlusStr = true;
                else
                    this.strPlusNumber = true;
                scope.root.headerFlags.strings = true;
                scope.root.headerFlags.malloc = true;
                scope.root.headerFlags.str_int16_t_cat = true;
            }

        }
        this.operator = operatorMap[node.operatorToken.kind];
        if (callReplaceMap[node.operatorToken.kind]) {
            this.replacedWithCall = true;
            [this.call, this.callCondition] = callReplaceMap[node.operatorToken.kind];
        }
        this.nodeText = node.getText();
    }
}


@CodeTemplate(`
{#if isPostfix && operator}
    {operand}{operator}
{#elseif !isPostfix && operator}
    {operator}{operand}
{#elseif replacedWithCall}
    {call}({operand}){callCondition}
{#else}
    /* unsupported expression {nodeText} */
{/if}`, [ts.SyntaxKind.PrefixUnaryExpression, ts.SyntaxKind.PostfixUnaryExpression])
class CUnaryExpression {
    public nodeText: string;
    public operator: string;
    public operand: CExpression;
    public isPostfix: boolean;
    public replacedWithCall: boolean = false;
    public call: string;
    public callCondition: string;
    constructor(scope: IScope, node: ts.PostfixUnaryExpression | ts.PrefixUnaryExpression) {
        let operatorMap: { [token: number]: string } = {};
        let callReplaceMap: { [token: number]: [string, string] } = {};
        let type = scope.root.typeHelper.getCType(node.operand);
        if (type == NumberVarType) {
            operatorMap[ts.SyntaxKind.PlusPlusToken] = '++';
            operatorMap[ts.SyntaxKind.MinusMinusToken] = '--';
            operatorMap[ts.SyntaxKind.ExclamationToken] = '!';
            callReplaceMap[ts.SyntaxKind.PlusToken] = ["atoi", ""];
            if (callReplaceMap[node.operator])
                scope.root.headerFlags.atoi = true;
        }
        this.operator = operatorMap[node.operator];
        if (callReplaceMap[node.operator]) {
            this.replacedWithCall = true;
            [this.call, this.callCondition] = callReplaceMap[node.operator];
        }
        this.operand = CodeTemplateFactory.createForNode(scope, node.operand);
        this.isPostfix = node.kind == ts.SyntaxKind.PostfixUnaryExpression;
        this.nodeText = node.getText();
    }
}

@CodeTemplate(`{condition} ? {whenTrue} : {whenFalse}`, ts.SyntaxKind.ConditionalExpression)
class CTernaryExpression {
    public condition: CExpression;
    public whenTrue: CExpression;
    public whenFalse: CExpression;
    constructor(scope: IScope, node: ts.ConditionalExpression) {
        this.condition = CodeTemplateFactory.createForNode(scope, node.condition);
        this.whenTrue = CodeTemplateFactory.createForNode(scope, node.whenTrue);
        this.whenFalse = CodeTemplateFactory.createForNode(scope, node.whenFalse);
    }
}

@CodeTemplate(`{expression}`, ts.SyntaxKind.ArrayLiteralExpression)
class CArrayLiteralExpression {
    public expression: string;
    constructor(scope: IScope, node: ts.ArrayLiteralExpression) {
        let arrSize = node.elements.length;
        if (arrSize == 0) {
            this.expression = "/* Empty array is not supported inside expressions */";
            return;
        }

        let varName = scope.root.typeHelper.addNewTemporaryVariable(node, "tmp_array");
        let type = scope.root.typeHelper.getCType(node);
        if (type instanceof ArrayType) {
            let canUseInitializerList = node.elements.every(e => e.kind == ts.SyntaxKind.NumericLiteral || e.kind == ts.SyntaxKind.StringLiteral);
            if (!type.isDynamicArray && canUseInitializerList) {
                let s = "{ ";
                for (let i = 0; i < arrSize; i++) {
                    if (i != 0)
                        s += ", ";
                    let cExpr = CodeTemplateFactory.createForNode(scope, node.elements[i]);
                    s += typeof cExpr === 'string' ? cExpr : (<any>cExpr).resolve();
                }
                s += " }";
                scope.variables.push(new CVariable(scope, varName, type, { initializer: s }));
            }
            else {
                scope.variables.push(new CVariable(scope, varName, type));
                if (type.isDynamicArray) {
                    scope.root.headerFlags.array = true;
                    scope.statements.push("ARRAY_CREATE(" + varName + ", " + arrSize + ", " + arrSize + ");\n");
                }
                for (let i = 0; i < arrSize; i++) {
                    let assignment = new CAssignment(scope, varName, i + "", type, node.elements[i])
                    scope.statements.push(assignment);
                }
            }
            this.expression = type.isDynamicArray ? "((void *)" + varName + ")" : varName;
        }
        else
            this.expression = "/* Unsupported use of array literal expression */";
    }
}

@CodeTemplate(`
{#if isSimpleVar || argumentExpression == null}
    {elementAccess}
{#elseif isDynamicArray && argumentExpression == 'length'}
    {elementAccess}->size
{#elseif isDynamicArray}
    {elementAccess}->data[{argumentExpression}]
{#elseif isStaticArray && argumentExpression == 'length'}
    {arrayCapacity}
{#elseif isStaticArray}
    {elementAccess}[{argumentExpression}]
{#elseif isStruct}
    {elementAccess}->{argumentExpression}
{#elseif isDict}
    DICT_GET({elementAccess}, {argumentExpression})
{#else}
    /* Unsupported expression {nodeText} */
{/if}`, [ts.SyntaxKind.ElementAccessExpression, ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.Identifier])
export class CElementAccess {
    public isSimpleVar: boolean;
    public isDynamicArray: boolean = false;
    public isStaticArray: boolean = false;
    public isStruct: boolean = false;
    public isDict: boolean = false;
    public elementAccess: CElementAccess | string;
    public argumentExpression: CExpression = null;
    public arrayCapacity: string;
    public nodeText: string;
    constructor(scope: IScope, node: ts.Node) {
        let type: CType = null;

        if (node.kind == ts.SyntaxKind.Identifier) {
            type = scope.root.typeHelper.getCType(node);
            this.elementAccess = node.getText();
        } else if (node.kind == ts.SyntaxKind.PropertyAccessExpression) {
            let propAccess = <ts.PropertyAccessExpression>node;
            type = scope.root.typeHelper.getCType(propAccess.expression);
            if (propAccess.expression.kind == ts.SyntaxKind.Identifier)
                this.elementAccess = propAccess.expression.getText();
            else
                this.elementAccess = new CElementAccess(scope, propAccess.expression);
            this.argumentExpression = propAccess.name.getText();
        } else if (node.kind == ts.SyntaxKind.ElementAccessExpression) {
            let elemAccess = <ts.ElementAccessExpression>node;
            type = scope.root.typeHelper.getCType(elemAccess.expression);
            if (elemAccess.expression.kind == ts.SyntaxKind.Identifier)
                this.elementAccess = elemAccess.expression.getText();
            else
                this.elementAccess = new CElementAccess(scope, elemAccess.expression);
            if (elemAccess.argumentExpression.kind == ts.SyntaxKind.StringLiteral) {
                let ident = elemAccess.argumentExpression.getText().slice(1, -1);
                if (ident.search(/^[_A-Za-z][_A-Za-z0-9]*$/) > -1)
                    this.argumentExpression = ident;
                else
                    this.argumentExpression = CodeTemplateFactory.createForNode(scope, elemAccess.argumentExpression);
            } else
                this.argumentExpression = CodeTemplateFactory.createForNode(scope, elemAccess.argumentExpression);
        }

        this.isSimpleVar = typeof type === 'string' && type != UniversalVarType && type != PointerVarType;
        this.isDynamicArray = type instanceof ArrayType && type.isDynamicArray;
        this.isStaticArray = type instanceof ArrayType && !type.isDynamicArray;
        this.arrayCapacity = type instanceof ArrayType && !type.isDynamicArray && type.capacity + "";
        this.isDict = type instanceof StructType && type.isDict;
        this.isStruct = type instanceof StructType && !type.isDict;
        this.nodeText = node.getText();

    }
}

@CodeTemplate(`{value}`, ts.SyntaxKind.StringLiteral)
export class CString {
    public value: string;
    constructor(scope: IScope, value: ts.StringLiteral) {
        let s = value.getText();
        if (s.indexOf("'") == 0)
            this.value = '"' + s.replace(/"/g, '\\"').replace(/([^\\])\\'/g, "$1'").slice(1, -1) + '"';
        else
            this.value = s;
    }
}

@CodeTemplate(`{value}`, [ts.SyntaxKind.NumericLiteral])
export class CNumber
{
    public value: string;
    constructor(scope: IScope, value: ts.Node)
    {
        this.value = value.getText();
    }
}
