@isTest
public class MyApexClass_Test {
    public static final Boolean FAIL = false;

    @isTest static void passingTest() {
        System.assertEquals(1, 1);
    }

    @isTest static void failingTest() {
        System.assertEquals(1, FAIL ? 2 : 1);
    }
}